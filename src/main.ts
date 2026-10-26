import { app, BrowserWindow, dialog, ipcMain, OpenDialogOptions, session } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import started from 'electron-squirrel-startup';
import { TutorApi, loadOrCreateToken, RendererCommand } from './main/tutorApi';
import {
  MUSICXML_EXTENSIONS,
  isPieceFileName,
  isScoreXml,
  pieceFileName,
  scoreTitle,
  titleFromPath,
} from './shared/pieceFiles';

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

const listPieces = async () => {
  const dir = piecesDir();
  const pieces = [];
  const skipped: string[] = [];
  try {
    await fs.mkdir(dir, { recursive: true });
    const names = (await fs.readdir(dir)).filter(isPieceFileName).sort();
    for (const name of names) {
      try {
        const musicxml = await readScoreFile(path.join(dir, name));
        pieces.push({ file: name, title: scoreTitle(musicxml) ?? titleFromPath(name), musicxml });
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

const startTutorApi = () => {
  ipcMain.handle('pieces:list', listPieces);
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
  });
  ipcMain.on('tutor:note', (_e, ev) => tutorApi?.onNote(ev));
  ipcMain.on('tutor:event', (_e, ev) => tutorApi?.onEvent(ev));
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
