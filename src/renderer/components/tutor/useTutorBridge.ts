import { useEffect } from 'react';
import { useMidiStore } from '../../store/useMidiStore';
import { useTutorStore } from '../../store/useTutorStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { rememberRef } from '../score/lastPiece';
import type { RendererCommand } from '../../../main/tutorApi';
import type { RecordingStatus } from '../../../main/recorder';
import type { InviteState } from '../../../main/invite';
import type { PieceTrust } from '../../../shared/trust';
import type { PieceGroupRef } from '../../../shared/versions';
import type { MixChoice } from '../../../shared/mix';
import type { Homework } from '../../engine/Homework';

// Wires the renderer to the tutor API in the main process: every note that
// goes through the store's single ingest path is reported up, and commands
// from the personas (tasks, pieces, injected test notes) come back down.

interface TutorBridge {
  note: (ev: unknown) => void;
  event?: (ev: unknown) => void;
  screen: (state: unknown) => void;
  device: (d: unknown) => void;
  openPiece: () => Promise<{ title: string; musicxml: string } | null>;
  listPieces?: () => Promise<{ file: string; title: string; musicxml: string; trust?: PieceTrust; group?: PieceGroupRef }[]>;
  writeScore?: (slug: string, musicxml: string) => Promise<void>;
  reviewAppend?: (slug: string, event: Record<string, unknown>) => Promise<unknown>;
  saveMix?: (slug: string, mix: { harder: string; choice: MixChoice[]; musicxml: string; trust: PieceTrust }) => Promise<{ file: string }>;
  getHomework?: () => Promise<Homework | null>;
  onCommand: (cb: (cmd: RendererCommand) => void) => () => void;
  toggleRecording?: () => Promise<RecordingStatus>;
  recordingStatus?: () => Promise<RecordingStatus>;
  inviteStatus?: () => Promise<{ state: InviteState; error?: string }>;
  inviteToggle?: () => Promise<{ state: InviteState; error?: string }>;
  takePcm?: (id: string, data: Uint8Array) => void;
  takePcmDone?: (msg: { id: string; sampleRate?: number; channels?: number; error?: string }) => void;
  /** #10236: the practice snapshot. force = this launch is a patch relaunch. Null in a hidden test copy. */
  sessionLoad?: () => Promise<{ snapshot: unknown; force: boolean } | null>;
  sessionSave?: (snapshot: unknown) => void;
  /** #5260: the note trainer's record. Null in a hidden test copy. */
  noteStatsLoad?: () => Promise<unknown>;
  noteStatsSave?: (record: unknown) => void;
  /** Scan review (#9664): null unless the desk app was started with a review library. */
  reviewInfo?: () => Promise<{ library: string } | null>;
}

declare global {
  interface Window {
    tutorBridge?: TutorBridge;
  }
}

/** Report on-screen state (piece, bar, feedback) to the tutor API. No-op outside Electron. */
export function reportScreen(state: Record<string, unknown>) {
  window.tutorBridge?.screen(state);
}

/** Add one entry to the API's debugging feed (/events + the on-box log). No-op outside Electron. */
export function reportEvent(kind: string, data: Record<string, unknown> = {}) {
  window.tutorBridge?.event?.({ kind, timestamp: Date.now(), ...data });
}

export function useTutorBridge(onShowScore: () => void) {
  useEffect(() => {
    const bridge = window.tutorBridge;
    if (!bridge) {
      console.warn('[tutor] no tutorBridge (preload missing): personas cannot see this window');
      return;
    }
    console.info('[tutor] bridge connected');

    const unsubNotes = useMidiStore.subscribe((state, prev) => {
      const latest = state.noteLog[0];
      if (!latest || latest === prev.noteLog[0]) return;
      bridge.note({
        kind: latest.kind,
        note: latest.note,
        velocity: latest.velocity,
        source: latest.source,
        timestamp: latest.timestamp,
      });
    });

    const unsubPedal = useMidiStore.subscribe((s, p) => {
      if (s.pedal !== p.pedal) reportEvent('pedal', { down: s.pedal });
    });

    const reportDevice = () => {
      const { connected, activeDevice, enabled, error } = useMidiStore.getState();
      bridge.device({ connected, name: activeDevice?.name ?? null, midiEnabled: enabled, error });
    };
    reportDevice();
    const unsubDevice = useMidiStore.subscribe((s, p) => {
      if (s.connected !== p.connected || s.activeDevice !== p.activeDevice || s.enabled !== p.enabled || s.error !== p.error) {
        reportDevice();
      }
    });

    const unsubCmd = bridge.onCommand((cmd) => {
      switch (cmd.type) {
        case 'inject':
          useMidiStore.getState().ingestNote({
            kind: cmd.kind,
            note: cmd.note,
            velocity: cmd.velocity,
            channel: 1,
            source: 'inject',
          });
          break;
        case 'task':
          useTutorStore.getState().setTask(cmd.task);
          onShowScore();
          break;
        case 'clear-task':
          useTutorStore.getState().setTask(null);
          break;
        case 'loop':
          useTutorStore.getState().requestLoop({ firstBar: cmd.firstBar, lastBar: cmd.lastBar, backwards: cmd.backwards === true });
          onShowScore();
          break;
        case 'clear-loop':
          useTutorStore.getState().requestLoop(null);
          break;
        case 'piece':
          useTutorStore.getState().addPiece({ label: cmd.title, xml: cmd.musicxml, photo: cmd.photo });
          // #10160: it's his last piece now, even if the Score tab mounts only after this.
          useSettingsStore.getState().setLastPiece(
            rememberRef(useTutorStore.getState().selectPieceId ?? '', cmd.title, !!cmd.musicxml),
          );
          onShowScore();
          break;
      }
    });

    return () => {
      unsubNotes();
      unsubPedal();
      unsubDevice();
      unsubCmd();
    };
  }, [onShowScore]);
}
