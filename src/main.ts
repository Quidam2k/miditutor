import { app, BrowserWindow, dialog, ipcMain, OpenDialogOptions, session } from 'electron';
import { createHash } from 'node:crypto';
import { createWriteStream, WriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import started from 'electron-squirrel-startup';
import { TutorApi, loadOrCreateToken, RendererCommand } from './main/tutorApi';
import { Recorder, outputSize } from './main/recorder';
import { Review, reviewConfig } from './main/review';
import {
  MUSICXML_EXTENSIONS,
  isPieceFileName,
  isScoreXml,
  pieceFileName,
  scoreTitle,
  titleFromPath,
} from './shared/pieceFiles';
import { TrustMap, parseTrust, trustFor } from './shared/trust';

if (started) {
  app.quit();
}

// Web MIDI is gated behind a Chromium permission. Without a handler that
// grants 'midi'/'midiSysex', navigator.requestMIDIAccess() (used by WebMidi.js)
// is denied and no keyboard input ever reaches the renderer.
// Scoped to the app's own origin (dev = the Vite server, prod = file://) so we
// never grant MIDI to arbitrary remote content the window might navigate to.
// The request handler gets a full URL ("http://localhost:5173/"), the check
// handler an origin; normalise both before comparing.
const isOwnOrigin = (origin: string | undefined): boolean => {
  if (!origin) return false;
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    try {
      if (new URL(origin).origin === new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin) return true;
    } catch {
      /* fall through to file:// check */
    }
  }
  return origin.startsWith('file://');
};

const isMidiPermission = (permission: string): boolean =>
  permission === 'midi' || permission === 'midiSysex';

const grantMidiPermissions = () => {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    callback(isMidiPermission(permission) && isOwnOrigin(details.requestingUrl));
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    return isMidiPermission(permission) && isOwnOrigin(requestingOrigin);
  });
};

// Tutor API: lets the Pantheon personas see what is played and put tasks/pieces
// on screen. Loopback only (reach it remotely through an SSH tunnel), bearer
// token in userData/api-token. /inject is for tests and is off in packaged
// builds unless MIDITUTOR_ALLOW_INJECT=1.
let mainWindow: BrowserWindow | null = null;
let tutorApi: TutorApi | null = null;

// Score file -> MusicXML text. A compressed .mxl is a zip whose container.xml
// names the score document inside.
const readScoreFile = async (filePath: string): Promise<string> => {
  const bytes = await fs.readFile(filePath);
  let text: string;
  if (filePath.toLowerCase().endsWith('.mxl')) {
    const zip = await JSZip.loadAsync(bytes);
    const container = zip.file('META-INF/container.xml');
    const rootPath = container
      ? /full-path="([^"]+)"/.exec(await container.async('string'))?.[1]
      : undefined;
    const entry = (rootPath ? zip.file(rootPath) : null) ??
      zip.file(/\.xml$/i).find((f) => !f.name.startsWith('META-INF/'));
    if (!entry) throw new Error('No score document inside this .mxl file');
    text = await entry.async('string');
  } else {
    text = bytes.toString('utf8');
  }
  if (!isScoreXml(text)) throw new Error('This file is not a MusicXML score');
  return text;
};

// His pieces live as files in ~/MidiTutor Pieces (#9477): the Score tab lists
// every score there, Open starts there, and a pushed piece is saved there so it
// survives a restart. Not ~/Documents: macOS privacy-gates that folder for an
// unsigned app, and the listing came back empty on Pinocchio.
// MIDITUTOR_PIECES_DIR points tests at a scratch folder.
const piecesDir = () =>
  process.env.MIDITUTOR_PIECES_DIR || path.join(app.getPath('home'), 'MidiTutor Pieces');

// trust.json (written by scripts/omr_audit.py trust, copied by sync_pieces.sh) says
// what is known about each score. Missing or unreadable means no badge, not an error.
const readTrust = async (dir: string): Promise<TrustMap> => {
  try {
    return parseTrust(JSON.parse(await fs.readFile(path.join(dir, 'trust.json'), 'utf8')));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('[pieces] trust.json unreadable:', (err as Error).message);
    return {};
  }
};

const fileSha256 = async (filePath: string) =>
  createHash('sha256').update(await fs.readFile(filePath)).digest('hex');

const listPieces = async () => {
  const dir = piecesDir();
  const pieces = [];
  const skipped: string[] = [];
  try {
    await fs.mkdir(dir, { recursive: true });
    const names = (await fs.readdir(dir)).filter(isPieceFileName).sort();
    const trust = await readTrust(dir);
    for (const name of names) {
      try {
        const musicxml = await readScoreFile(path.join(dir, name));
        let entry = trustFor(trust, name);
        // His "Verified by you" holds only for the exact file he reviewed (#9664).
        if (entry?.status === 'verified' && entry.sha !== await fileSha256(path.join(dir, name))) entry = undefined;
        pieces.push({
          file: name,
          title: scoreTitle(musicxml) ?? titleFromPath(name),
          musicxml,
          ...(entry ? { trust: entry } : {}),
        });
      } catch (err) {
        skipped.push(`${name}: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    tutorApi?.onEvent({ kind: 'pieces', timestamp: Date.now(), dir, error: (err as Error).message });
    throw err;
  }
  tutorApi?.onEvent({ kind: 'pieces', timestamp: Date.now(), dir, count: pieces.length, skipped });
  return pieces;
};

const savePiece = async (title: string, musicxml: string) => {
  await fs.mkdir(piecesDir(), { recursive: true });
  await fs.writeFile(path.join(piecesDir(), pieceFileName(title)), musicxml, 'utf8');
};

// Take recorder (#9574): the window's own frames -> bundled ffmpeg, plus piano
// audio the renderer renders from his MIDI after Stop. Saved to ~/Movies/MidiTutor
// (Videos\MidiTutor on Windows). beginFrameSubscription needs no Screen
// Recording permission, unlike desktopCapturer.
const ffmpegPath = () => {
  if (process.env.MIDITUTOR_FFMPEG) return process.env.MIDITUTOR_FFMPEG;
  const name = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  return app.isPackaged
    ? path.join(process.resourcesPath, name)
    : path.join(app.getAppPath(), 'node_modules', 'ffmpeg-static', name);
};
const recordingsDir = () =>
  process.env.MIDITUTOR_RECORDINGS_DIR || path.join(app.getPath('videos'), 'MidiTutor');

// The renderer streams a take's PCM back in chunks; each take waits here until done.
const pendingAudio = new Map<string, {
  out: WriteStream;
  resolve: (fmt: { sampleRate: number; channels: number }) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

const settleAudio = (id: string, err: Error | null, fmt?: { sampleRate: number; channels: number }) => {
  const pending = pendingAudio.get(id);
  if (!pending) return;
  pendingAudio.delete(id);
  clearTimeout(pending.timer);
  if (err || !fmt) {
    pending.out.destroy();
    pending.reject(err ?? new Error('no audio'));
  } else {
    pending.out.end((e?: Error | null) => (e ? pending.reject(e) : pending.resolve(fmt)));
  }
};

// Built once the app is ready (app paths), in startTutorApi.
let recorder!: Recorder;
const makeRecorder = () => new Recorder({
  ffmpegPath: ffmpegPath(),
  outDir: recordingsDir(),
  frames: (size) => {
    const wc = mainWindow?.webContents;
    if (!wc) throw new Error('no window');
    return {
      subscribe: (cb) => wc.beginFrameSubscription(false, (image) =>
        cb(() => image.resize({ ...size, quality: 'good' }).toBitmap())),
      unsubscribe: () => { if (!wc.isDestroyed()) wc.endFrameSubscription(); },
    };
  },
  renderAudio: ({ id, events, durationMs, pcmPath }) => new Promise((resolve, reject) => {
    if (!mainWindow) return reject(new Error('no window'));
    // A minute of audio renders in well under a second; allow generously for long takes.
    const timer = setTimeout(() => settleAudio(id, new Error('render timed out')), 60_000 + durationMs);
    const out = createWriteStream(pcmPath);
    out.on('error', (err) => settleAudio(id, err));   // disk full, permissions
    pendingAudio.set(id, { out, resolve, reject, timer });
    mainWindow.webContents.send('tutor:command', { type: 'render-take', id, events, durationMs });
  }),
  onStatus: (status) => mainWindow?.webContents.send('tutor:command', { type: 'recording', status }),
  onEvent: (ev) => tutorApi?.onEvent({ kind: 'recording', timestamp: Date.now(), ...ev }),
});

const startTake = () => {
  if (!mainWindow) throw new Error('no window');
  const [width, height] = mainWindow.getContentSize();
  return recorder.start(outputSize(width, height));
};

// The button does not wait for the save; the status push reports it.
const stopTake = () => {
  recorder.stop().catch((err) => console.warn('[recorder] take failed:', (err as Error).message));
};

const startTutorApi = () => {
  recorder = makeRecorder();
  ipcMain.handle('recorder:status', () => recorder.status());
  ipcMain.handle('recorder:toggle', () => {
    if (recorder.status().state === 'recording') {
      stopTake();
    } else {
      startTake();
    }
    return recorder.status();
  });
  ipcMain.on('recorder:pcm', (_e, { id, data }: { id: string; data: Uint8Array }) => {
    pendingAudio.get(id)?.out.write(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  });
  ipcMain.on('recorder:pcm-done', (_e, msg: { id: string; sampleRate?: number; channels?: number; error?: string }) => {
    if (msg.error || !msg.sampleRate || !msg.channels) settleAudio(msg.id, new Error(msg.error ?? 'bad audio'));
    else settleAudio(msg.id, null, { sampleRate: msg.sampleRate, channels: msg.channels });
  });
  ipcMain.handle('pieces:list', listPieces);
  // JP's newest lesson entry, written by scripts/homework_sync.py; null until the first sync (#5058).
  ipcMain.handle('homework:get', async () => {
    try {
      return JSON.parse(await fs.readFile(path.join(piecesDir(), 'homework.json'), 'utf8'));
    } catch {
      return null;
    }
  });
  ipcMain.handle('piece:open', async () => {
    await fs.mkdir(piecesDir(), { recursive: true }).catch(() => undefined);
    const options: OpenDialogOptions = {
      title: 'Open piece',
      defaultPath: piecesDir(),
      properties: ['openFile'],
      filters: [{ name: 'MusicXML score', extensions: [...MUSICXML_EXTENSIONS] }],
    };
    const picked = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    const filePath = picked.filePaths[0];
    if (picked.canceled || !filePath) return null;
    return { title: titleFromPath(filePath), musicxml: await readScoreFile(filePath) };
  });
  // Scan review (#9664): desk only, when started with --review-library=<dir>.
  const reviewCfg = reviewConfig(process.argv, app.getAppPath());
  const review = reviewCfg ? new Review(reviewCfg) : null;
  ipcMain.handle('review:info', () => (review ? { library: review.library } : null));
  if (review) {
    ipcMain.handle('review:list', () => review.list());
    ipcMain.handle('review:piece', (_e, slug: string) => review.ensureLayout(slug));
    ipcMain.handle('review:crop', (_e, slug: string, rel: string) => review.crop(slug, rel));
    ipcMain.handle('review:append', (_e, slug: string, event: Record<string, unknown>) => review.append(slug, event));
    ipcMain.handle('review:accept', (_e, slug: string, proposal: string) => review.accept(slug, proposal));
    ipcMain.handle('review:recheck', (_e, slug: string, mark: string) => review.recheck(slug, mark));
    ipcMain.handle('review:proposal', (_e, slug: string, proposal: string) => review.proposalView(slug, proposal));
  }
  const send = (cmd: RendererCommand) => mainWindow?.webContents.send('tutor:command', cmd);
  tutorApi = new TutorApi({
    port: Number(process.env.MIDITUTOR_PORT ?? 47800),
    token: loadOrCreateToken(app.getPath('userData')),
    logDir: path.join(app.getPath('userData'), 'logs'),
    allowInject: !app.isPackaged || process.env.MIDITUTOR_ALLOW_INJECT === '1',
    sendToRenderer: send,
    savePiece: (title, musicxml) =>
      savePiece(title, musicxml).catch((err) => console.warn('[pieces] save failed:', (err as Error).message)),
    capture: async () => {
      if (!mainWindow) throw new Error('no window');
      return (await mainWindow.webContents.capturePage()).toPNG();
    },
    recorder: { status: () => recorder.status(), start: startTake, stop: () => recorder.stop() },
  });
  ipcMain.on('tutor:note', (_e, ev) => {
    tutorApi?.onNote(ev);
    recorder.noteEvent(ev);
  });
  ipcMain.on('tutor:event', (_e, ev) => {
    tutorApi?.onEvent(ev);
    if (ev?.kind === 'pedal') recorder.pedalEvent({ down: !!ev.down, timestamp: ev.timestamp ?? Date.now() });
  });
  ipcMain.on('tutor:screen', (_e, st) => tutorApi?.onRendererState(st));
  ipcMain.on('tutor:device', (_e, d) => tutorApi?.onDevice(d));
  tutorApi
    .start()
    .then((port) => console.log(`[tutor-api] listening on 127.0.0.1:${port}`))
    .catch((err) => console.error('[tutor-api] failed to start:', err));
};

const hidden = process.env.MIDITUTOR_HIDDEN === '1';

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'MidiTutor',
    // MIDITUTOR_HIDDEN=1: run without showing a window (automated tests, CI smoke).
    show: !hidden,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: !hidden,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // A take outliving its window (closing it on macOS) saves what it has.
  mainWindow.on('closed', () => {
    mainWindow = null;
    if (recorder?.status().state === 'recording') stopTake();
  });

  // Log renderer errors to console
  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error(`Failed to load: ${code} ${desc}`);
  });

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('Render process gone:', details.reason);
  });

  mainWindow.webContents.on('console-message', (_e, level, message) => {
    const levels = ['verbose', 'info', 'warning', 'error'];
    console.log(`[renderer:${levels[level] ?? level}] ${message}`);
  });
};

app.on('ready', () => {
  grantMidiPermissions();
  startTutorApi();
  createWindow();
});

app.on('will-quit', () => {
  tutorApi?.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
