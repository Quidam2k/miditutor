import { useEffect, useState } from 'react';
import { pcmChunks, renderTake } from '../../audio/OfflinePiano';
import type { RecordingStatus, TakeEvent } from '../../../main/recorder';

// Record a take for showing someone (#9574): the window as video, and a piano
// rendered from exactly what he played (the Roland's own sound is not captured).
// Main does the capture and the mp4; this button toggles it and renders the
// audio main asks for after Stop.

const CREDIT = 'Piano sound: Salamander Grand Piano by Alexander Holm (CC-BY 3.0)';

async function renderAndSend(id: string, events: TakeEvent[], durationMs: number) {
  const bridge = window.tutorBridge;
  if (!bridge?.takePcm || !bridge.takePcmDone) return;
  try {
    const buffer = await renderTake(events, durationMs);
    for await (const chunk of pcmChunks(buffer)) {
      bridge.takePcm(id, new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    }
    bridge.takePcmDone({ id, sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels });
  } catch (err) {
    bridge.takePcmDone({ id, error: (err as Error).message });
  }
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function RecordButton() {
  const [status, setStatus] = useState<RecordingStatus | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const bridge = window.tutorBridge;
    if (!bridge?.recordingStatus) return;
    void bridge.recordingStatus().then(setStatus);
    return bridge.onCommand((cmd) => {
      if (cmd.type === 'recording') setStatus(cmd.status);
      else if (cmd.type === 'render-take') void renderAndSend(cmd.id, cmd.events, cmd.durationMs);
    });
  }, []);

  const recording = status?.state === 'recording';
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [recording]);

  if (!status) return null;
  const toggle = () => void window.tutorBridge?.toggleRecording?.().then(setStatus);
  const saved = status.lastPath ? status.lastPath.split(/[\\/]/).pop() : null;
  const note = status.finishing > 0 ? 'Saving…' : status.lastError ? `Problem: ${status.lastError}` : saved ? `Saved ${saved}` : '';

  return (
    <div className="flex items-center gap-2 text-xs">
      {note && !recording && (
        <span className="text-gray-500 max-w-64 truncate" title={status.lastPath ?? status.lastError ?? ''}>{note}</span>
      )}
      <button
        onClick={toggle}
        title={`Record this window as an mp4 with a piano rendered from what you play. ${CREDIT}`}
        className={`flex items-center gap-1.5 rounded-md px-3 py-1 font-medium transition-colors ${
          recording ? 'bg-red-600 text-white hover:bg-red-500' : 'text-gray-400 hover:bg-gray-800/60 hover:text-gray-200'
        }`}
      >
        <span className={`inline-block h-2.5 w-2.5 ${recording ? 'rounded-sm bg-white' : 'rounded-full bg-red-500'}`} />
        {recording ? `Stop ${clock(now - (status.startedAt ?? now))}` : 'Record'}
      </button>
    </div>
  );
}

export { CREDIT as PIANO_CREDIT };
