import { app, BrowserWindow, dialog, ipcMain, OpenDialogOptions, screen, session } from 'electron';
import { createHash } from 'node:crypto';
import { createWriteStream, WriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import started from 'electron-squirrel-startup';
import { TutorApi, loadOrCreateToken, RendererCommand } from './main/tutorApi';
import { Recorder, outputSize } from './main/recorder';
import { InviteTimer, postLive } from './main/invite';
import { onSomeDisplay, sessionFiles, WindowState } from './main/sessionFiles';
import { Review, mirrorConfig, reviewConfig, sshRemote } from './main/review';
import {
  MUSICXML_EXTENSIONS,
  isPieceFileName,
  isScoreXml,
  pieceFileName,
  scoreTitle,
  titleFromPath,
} from './shared/pieceFiles';
import { TrustMap, parseTrust, trustFor } from './shared/trust';
import { SavedMix, VersionMap, applyTrust, groupOf, mixPlanOf, parseMixes, parseVersions, withMixes } from './shared/versions';

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

// versions.json (#9627, copied by sync_pieces.sh) groups the files that are one song
// (Easy / Harder / My mix). Missing or unreadable means every file stands alone.
const readVersions = async (dir: string): Promise<VersionMap> => {
  try {
    return parseVersions(JSON.parse(await fs.readFile(path.join(dir, 'versions.json'), 'utf8')));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('[pieces] versions.json unreadable:', (err as Error).message);
    return {};
  }
};

// mixes.json (#9627): his My mix files, made on whichever box he is on. Local only:
// sync_pieces.sh never copies it (or the *-my-mix files), so the desk can't clobber Pinocchio's.
const readMixes = async (dir: string): Promise<Record<string, SavedMix>> => {
  try {
    return parseMixes(JSON.parse(await fs.readFile(path.join(dir, 'mixes.json'), 'utf8')));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('[pieces] mixes.json unreadable:', (err as Error).message);
    return {};
  }
};

// The renderer splices the mix (it has the DOM); main checks it belongs to an aligned song and writes it.
// #9988: his fingering edit, written back over a score already in the pieces folder.
const writeScore = async (slug: string, musicxml: string) => {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error('bad piece name');
  const file = path.join(piecesDir(), `${slug}.musicxml`);
  await fs.access(file);
  if (!isScoreXml(musicxml)) throw new Error('not a MusicXML score');
  await fs.writeFile(file, musicxml, 'utf8');
};

const saveMix = async (slug: string, mix: { harder: string; choice: unknown; musicxml: string; trust: unknown }) => {
  const dir = piecesDir();
  // Same view as the picker: no mix from a hidden or no_mix Harder version (#9794).
  const group = applyTrust(await readVersions(dir), await readTrust(dir)).versions[slug];
  const plan = group && mixPlanOf(group);
  if (!plan || plan.harder !== mix.harder) throw new Error(`${slug} has no My mix`);
  if (!isScoreXml(mix.musicxml)) throw new Error('The mix is not a MusicXML score');
  const file = `${slug}-my-mix.musicxml`;
  const saved = parseMixes({ [slug]: { file, harder: mix.harder, choice: mix.choice, trust: mix.trust } })[slug];
  if (!saved || saved.choice.length !== plan.sections.length) throw new Error('The mix choices do not fit its sections');
  await fs.writeFile(path.join(dir, file), mix.musicxml, 'utf8');
  const mixes = { ...(await readMixes(dir)), [slug]: saved };
  await fs.writeFile(path.join(dir, 'mixes.json'), JSON.stringify(mixes, null, 2) + '\n', 'utf8');
  tutorApi?.onEvent({ kind: 'pieces', timestamp: Date.now(), dir, mix: file, choice: saved.choice });
  return { file };
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
    const mixes = await readMixes(dir);
    // trust.json can hide an unusable version or turn My mix off (#9794).
    const { versions, hidden } = applyTrust(withMixes(await readVersions(dir), mixes), trust);
    const mixTrust = new Map(Object.values(mixes).map((m) => [m.file, m.trust]));
    for (const name of names) {
      if (hidden.has(name)) continue;
      try {
        const musicxml = await readScoreFile(path.join(dir, name));
        let entry = mixTrust.get(name) ?? trustFor(trust, name);
        // His "Verified by you" holds only for the exact file he reviewed (#9664).
        if (entry?.status === 'verified' && entry.sha !== await fileSha256(path.join(dir, name))) entry = undefined;
        const group = groupOf(versions, name);
        pieces.push({
          file: name,
          title: scoreTitle(musicxml) ?? titleFromPath(name),
          musicxml,
          ...(entry ? { trust: entry } : {}),
          ...(group ? { group } : {}),
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

// "Bring in the tutor" (#5154): his button asks Pantheon (on Solace) to open the tutor link
// and put Jarvis + Karen on him; it ends 10 min after his last note, or on a second press.
// Pantheon also polls /state and tears down on its own. The address and Solace's
// self-signed cert (pinned) are files deploy writes into userData; env overrides for tests.
const readSetting = async (name: string, env: string | undefined): Promise<string> => {
  if (env) return env;
  try {
    return (await fs.readFile(path.join(app.getPath('userData'), name), 'utf8')).trim();
  } catch {
    return '';
  }
};
const pantheonUrl = async () =>
  (await readSetting('pantheon-url', process.env.MIDITUTOR_PANTHEON_URL)) || 'https://192.168.50.139:7861';
const pantheonCert = async () => {
  const file = process.env.MIDITUTOR_PANTHEON_CERT;
  if (file) return fs.readFile(file, 'utf8').catch(() => null);
  return (await readSetting('pantheon-cert.pem', undefined)) || null;
};

let apiToken = '';
let inviteSentAt = 0;
const invite = new InviteTimer({
  idleMs: Number(process.env.MIDITUTOR_INVITE_IDLE_MS ?? 10 * 60_000),
  onIdle: () => {
    endInvite('idle');
    mainWindow?.webContents.send('tutor:command', { type: 'invite', state: invite.state() });
  },
});

// Off locally whatever Pantheon says: its poll sees invite.active false and tears down.
const endInvite = (reason: 'button' | 'idle' | 'quit') => {
  invite.stop();
  tutorApi?.onEvent({ kind: 'invite-off', timestamp: Date.now(), reason });
  void tellPantheon('off');
};

const tellPantheon = async (action: 'on' | 'off') => {
  const result = await postLive(action, { url: await pantheonUrl(), token: apiToken, certPem: await pantheonCert() });
  if (!result.ok) {
    console.warn(`[invite] Pantheon ${action} failed:`, result.error);
    tutorApi?.onEvent({ kind: 'invite-error', timestamp: Date.now(), action, error: result.error });
  }
  return result;
};

const toggleInvite = async () => {
  if (invite.state().active) {
    endInvite('button');
    return { state: invite.state() };
  }
  const result = await tellPantheon('on');
  if (!result.ok) return { state: invite.state(), error: "Couldn't reach Pantheon" };
  invite.start();
  tutorApi?.onEvent({ kind: 'invite-on', timestamp: Date.now(), reason: 'button' });
  return { state: invite.state() };
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
  ipcMain.handle('invite:status', () => ({ state: invite.state() }));
  ipcMain.handle('invite:toggle', toggleInvite);
  ipcMain.handle('pieces:list', listPieces);
  ipcMain.handle('pieces:saveMix', (_e, slug: string, mix) => saveMix(slug, mix));
  ipcMain.handle('pieces:writeScore', (_e, slug: string, musicxml: string) => writeScore(slug, musicxml));
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
  // Scan review (#9664): the desk, when started with --review-library=<dir> (and
  // --review-pinocchio=<ssh host> to take Pinocchio's marks); Pinocchio, once the
  // desk has synced a review folder into his pieces folder (#9666).
  const deskCfg = reviewConfig(process.argv, app.getAppPath());
  const reviewCfg = deskCfg ?? mirrorConfig(piecesDir());
  const review = reviewCfg
    ? new Review(reviewCfg, deskCfg?.pinocchio ? sshRemote(deskCfg.pinocchio, deskCfg.library) : null)
    : null;
  ipcMain.handle('review:info', () => (review ? { library: review.library, mirror: review.mirror } : null));
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
  apiToken = loadOrCreateToken(app.getPath('userData'));
  tutorApi = new TutorApi({
    port: Number(process.env.MIDITUTOR_PORT ?? 47800),
    token: apiToken,
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
    invite,
  });
  ipcMain.on('tutor:note', (_e, ev) => {
    tutorApi?.onNote(ev);
    recorder.noteEvent(ev);
    if (ev?.kind === 'noteon') {
      invite.noteOn();
      // The button's "N min left" reads endsAt, which every note moves (#10171). It only
      // changes by the minute, so once a second is plenty for fast passages.
      const now = Date.now();
      if (invite.state().active && now - inviteSentAt >= 1000) {
        inviteSentAt = now;
        mainWindow?.webContents.send('tutor:command', { type: 'invite', state: invite.state() });
      }
    }
  });
  ipcMain.on('tutor:event', (_e, ev) => {
    tutorApi?.onEvent(ev);
    if (ev?.kind === 'pedal') recorder.pedalEvent({ down: !!ev.down, timestamp: ev.timestamp ?? Date.now() });
  });
  ipcMain.on('tutor:screen', (_e, st) => tutorApi?.onRendererState(st));
  ipcMain.on('tutor:device', (_e, d) => tutorApi?.onDevice(d));
  // #9926: the tutor API port is this copy's single-instance claim. Another MidiTutor already holding it
  // (default 47800, or MIDITUTOR_PORT) means this copy exits quietly and logs it. It never focuses or raises
  // the running window. e2e runs on their own MIDITUTOR_PORT still start alongside.
  return tutorApi
    .start()
    .then((port) => {
      console.log(`[tutor-api] listening on 127.0.0.1:${port}`);
      return true;
    })
    .catch((err: NodeJS.ErrnoException) => {
      if (err?.code === 'EADDRINUSE') {
        console.log(`[single-instance] MidiTutor already holds port ${process.env.MIDITUTOR_PORT ?? 47800}; this copy exits (#9926)`);
        app.exit(0);
        return false;
      }
      console.error('[tutor-api] failed to start:', err);
      return true;
    });
};

const hidden = process.env.MIDITUTOR_HIDDEN === '1';
// #10236: a hidden copy (deploy check, tests) must not touch his place. MIDITUTOR_TEST_SESSION=1
// lets the relaunch e2e use it, on its own user data.
const useSession = !hidden || process.env.MIDITUTOR_TEST_SESSION === '1';
const files = () => sessionFiles(app.getPath('userData'));

ipcMain.handle('session:load', () => (useSession ? files().loadSession() : null));
ipcMain.on('session:save', (_e, snapshot: unknown) => {
  if (useSession) files().saveSession(snapshot).catch((err) => console.error('[session] save failed:', err));
});
ipcMain.handle('noteStats:load', () => (useSession ? files().loadNoteStats() : null));
ipcMain.on('noteStats:save', (_e, record: unknown) => {
  if (useSession) files().saveNoteStats(record).catch((err) => console.error('[note-stats] save failed:', err));
});
// MIDITUTOR_WINDOW_SIZE=1920x1080: test a TV-shaped window without showing one (#5153).
const [winW, winH] = (process.env.MIDITUTOR_WINDOW_SIZE ?? '').split('x').map(Number);

const createWindow = async () => {
  // Where he left it, unless that display is gone. A test's own size wins.
  const saved = hidden || winW ? null : await files().loadWindow();
  const place = saved && onSomeDisplay(saved, screen.getAllDisplays().map((d) => d.workArea)) ? saved : null;
  mainWindow = new BrowserWindow({
    width: place?.width ?? (winW || 1200),
    height: place?.height ?? (winH || 800),
    ...(place ? { x: place.x, y: place.y, fullscreen: place.fullScreen } : {}),
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

  if (!hidden) {
    const win = mainWindow;
    let timer: NodeJS.Timeout | undefined;
    const saveSoon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (win.isDestroyed()) return;
        // Normal bounds: the size to come back to when he leaves full screen.
        const state: WindowState = { ...win.getNormalBounds(), fullScreen: win.isFullScreen() };
        files().saveWindow(state).catch((err) => console.error('[session] window save failed:', err));
      }, 500);
    };
    for (const ev of ['resize', 'move', 'enter-full-screen', 'leave-full-screen'] as const) {
      win.on(ev as 'resize', saveSoon);
    }
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

app.on('ready', async () => {
  grantMidiPermissions();
  if (!(await startTutorApi())) return; // #9926 a second copy: exit before any window exists
  await createWindow();
});

app.on('will-quit', () => {
  // Quitting mid-invite ends it; Pantheon would notice anyway when /state stops answering.
  if (invite.state().active) endInvite('quit');
  tutorApi?.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});
