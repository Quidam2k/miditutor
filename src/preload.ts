// Bridge between the renderer and the tutor API in the main process. The
// renderer reports what is played and what is on screen; main sends commands
// (tasks, pieces, injected notes) back. Nothing else is exposed.
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

type Listener = (cmd: unknown) => void;

contextBridge.exposeInMainWorld('tutorBridge', {
  note: (ev: unknown) => ipcRenderer.send('tutor:note', ev),
  // Pedal, follower verdicts, loop/restart: the debugging feed (#9481).
  event: (ev: unknown) => ipcRenderer.send('tutor:event', ev),
  screen: (state: unknown) => ipcRenderer.send('tutor:screen', state),
  device: (d: unknown) => ipcRenderer.send('tutor:device', d),
  // Native file picker for a MusicXML score; resolves null when cancelled.
  openPiece: () => ipcRenderer.invoke('piece:open'),
  // Every score in ~/MidiTutor Pieces: [{ file, title, musicxml, trust? }] (trust from trust.json).
  listPieces: () => ipcRenderer.invoke('pieces:list'),
  // Take recorder (#9574): toggle, current status, and the piano audio rendered after Stop.
  toggleRecording: () => ipcRenderer.invoke('recorder:toggle'),
  recordingStatus: () => ipcRenderer.invoke('recorder:status'),
  takePcm: (id: string, data: Uint8Array) => ipcRenderer.send('recorder:pcm', { id, data }),
  takePcmDone: (msg: unknown) => ipcRenderer.send('recorder:pcm-done', msg),
  onCommand: (cb: Listener) => {
    const handler = (_e: IpcRendererEvent, cmd: unknown) => cb(cmd);
    ipcRenderer.on('tutor:command', handler);
    return () => ipcRenderer.removeListener('tutor:command', handler);
  },
});
