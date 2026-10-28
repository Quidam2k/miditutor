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
  // My mix (#9627): write <slug>-my-mix.musicxml + mixes.json; resolves { file }.
  saveMix: (slug: string, mix: unknown) => ipcRenderer.invoke('pieces:saveMix', slug, mix),
  // #9988: overwrite <slug>.musicxml in the pieces folder (his fingering edit).
  writeScore: (slug: string, musicxml: string) => ipcRenderer.invoke('pieces:writeScore', slug, musicxml),
  // ~/MidiTutor Pieces/homework.json (JP's newest lesson entry), or null.
  getHomework: () => ipcRenderer.invoke('homework:get'),
  // Take recorder (#9574): toggle, current status, and the piano audio rendered after Stop.
  toggleRecording: () => ipcRenderer.invoke('recorder:toggle'),
  recordingStatus: () => ipcRenderer.invoke('recorder:status'),
  takePcm: (id: string, data: Uint8Array) => ipcRenderer.send('recorder:pcm', { id, data }),
  takePcmDone: (msg: unknown) => ipcRenderer.send('recorder:pcm-done', msg),
  // Scan review (#9664): null from reviewInfo unless the desk app was started with a review library.
  reviewInfo: () => ipcRenderer.invoke('review:info'),
  reviewList: () => ipcRenderer.invoke('review:list'),
  reviewPiece: (slug: string) => ipcRenderer.invoke('review:piece', slug),
  reviewCrop: (slug: string, rel: string) => ipcRenderer.invoke('review:crop', slug, rel),
  reviewAppend: (slug: string, event: unknown) => ipcRenderer.invoke('review:append', slug, event),
  reviewAccept: (slug: string, proposal: string) => ipcRenderer.invoke('review:accept', slug, proposal),
  reviewRecheck: (slug: string, mark: string) => ipcRenderer.invoke('review:recheck', slug, mark),
  reviewProposal: (slug: string, proposal: string) => ipcRenderer.invoke('review:proposal', slug, proposal),
  // "Bring in the tutor" (#5154): { state, error? }.
  inviteStatus: () => ipcRenderer.invoke('invite:status'),
  inviteToggle: () => ipcRenderer.invoke('invite:toggle'),
  onCommand: (cb: Listener) => {
    const handler = (_e: IpcRendererEvent, cmd: unknown) => cb(cmd);
    ipcRenderer.on('tutor:command', handler);
    return () => ipcRenderer.removeListener('tutor:command', handler);
  },
});
