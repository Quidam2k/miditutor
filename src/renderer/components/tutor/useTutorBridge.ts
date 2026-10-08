import { useEffect } from 'react';
import { useMidiStore } from '../../store/useMidiStore';
import { useTutorStore } from '../../store/useTutorStore';
import type { RendererCommand } from '../../../main/tutorApi';

// Wires the renderer to the tutor API in the main process: every note that
// goes through the store's single ingest path is reported up, and commands
// from the personas (tasks, pieces, injected test notes) come back down.

interface TutorBridge {
  note: (ev: unknown) => void;
  screen: (state: unknown) => void;
  device: (d: unknown) => void;
  openPiece: () => Promise<{ title: string; musicxml: string } | null>;
  onCommand: (cb: (cmd: RendererCommand) => void) => () => void;
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
        case 'piece':
          useTutorStore.getState().addPiece({ label: cmd.title, xml: cmd.musicxml, photo: cmd.photo });
          onShowScore();
          break;
      }
    });

    return () => {
      unsubNotes();
      unsubDevice();
      unsubCmd();
    };
  }, [onShowScore]);
}
