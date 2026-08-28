import { app, BrowserWindow, session } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';

if (started) {
  app.quit();
}

// Web MIDI is gated behind a Chromium permission. Without a handler that
// grants 'midi'/'midiSysex', navigator.requestMIDIAccess() (used by WebMidi.js)
// is denied and no keyboard input ever reaches the renderer.
// Scoped to the app's own origin (dev = the Vite server, prod = file://) so we
// never grant MIDI to arbitrary remote content the window might navigate to.
const isOwnOrigin = (origin: string | undefined): boolean => {
  if (!origin) return false;
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    try {
      if (origin === new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin) return true;
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

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'MidiTutor',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
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
  createWindow();
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
