// Bridge between the renderer and the tutor API in the main process. The
// renderer reports what is played and what is on screen; main sends commands
// (tasks, pieces, injected notes) back. Nothing else is exposed.
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

type Listener = (cmd: unknown) => void;

contextBridge.exposeInMainWorld('tutorBridge', {
  note: (ev: unknown) => ipcRenderer.send('tutor:note', ev),
  screen: (state: unknown) => ipcRenderer.send('tutor:screen', state),
  device: (d: unknown) => ipcRenderer.send('tutor:device', d),
  onCommand: (cb: Listener) => {
    const handler = (_e: IpcRendererEvent, cmd: unknown) => cb(cmd);
    ipcRenderer.on('tutor:command', handler);
    return () => ipcRenderer.removeListener('tutor:command', handler);
  },
});
