import { create } from 'zustand';
import { MidiDevice, MidiNoteEvent, MidiLogEntry } from '../types/midi';
import { midiNumberToPitch, pitchToDisplayName } from '../engine/MusicTheory';

const MAX_LOG = 200;
let logId = 0;

interface IngestArgs {
  kind: 'noteon' | 'noteoff';
  note: number;
  velocity: number;
  channel: number;
  source: 'hardware' | 'virtual';
  timestamp?: number;
}

interface MidiState {
  connected: boolean;
  devices: MidiDevice[];
  activeDevice: MidiDevice | null;
  lastNoteOn: MidiNoteEvent | null;
  noteLog: MidiLogEntry[];
  enabled: boolean;
  error: string | null;

  setConnected: (connected: boolean) => void;
  setDevices: (devices: MidiDevice[]) => void;
  setActiveDevice: (device: MidiDevice | null) => void;
  setLastNoteOn: (event: MidiNoteEvent) => void;
  // Single ingestion path for every note event, hardware or virtual keyboard:
  // appends to the monitor log and, on note-on, drives the exercise engine.
  ingestNote: (args: IngestArgs) => void;
  clearLog: () => void;
  setEnabled: (enabled: boolean) => void;
  setError: (error: string | null) => void;
}

export const useMidiStore = create<MidiState>((set) => ({
  connected: false,
  devices: [],
  activeDevice: null,
  lastNoteOn: null,
  noteLog: [],
  enabled: false,
  error: null,

  setConnected: (connected) => set({ connected }),
  setDevices: (devices) => set({ devices }),
  setActiveDevice: (device) => set({ activeDevice: device, connected: device !== null }),
  setLastNoteOn: (event) => set({ lastNoteOn: event }),

  ingestNote: ({ kind, note, velocity, channel, source, timestamp }) =>
    set((state) => {
      const ts = timestamp ?? Date.now();
      const entry: MidiLogEntry = {
        id: ++logId,
        kind,
        note,
        noteName: pitchToDisplayName(midiNumberToPitch(note)),
        velocity,
        channel,
        source,
        timestamp: ts,
      };
      const noteLog = [entry, ...state.noteLog].slice(0, MAX_LOG);
      return kind === 'noteon'
        ? { noteLog, lastNoteOn: { note, velocity, timestamp: ts } }
        : { noteLog };
    }),

  clearLog: () => set({ noteLog: [] }),
  setEnabled: (enabled) => set({ enabled }),
  setError: (error) => set({ error }),
}));
