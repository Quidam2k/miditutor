import { create } from 'zustand';
import { MidiDevice, MidiNoteEvent } from '../types/midi';

interface MidiState {
  connected: boolean;
  devices: MidiDevice[];
  activeDevice: MidiDevice | null;
  lastNoteOn: MidiNoteEvent | null;
  enabled: boolean;
  error: string | null;

  setConnected: (connected: boolean) => void;
  setDevices: (devices: MidiDevice[]) => void;
  setActiveDevice: (device: MidiDevice | null) => void;
  setLastNoteOn: (event: MidiNoteEvent) => void;
  setEnabled: (enabled: boolean) => void;
  setError: (error: string | null) => void;
}

export const useMidiStore = create<MidiState>((set) => ({
  connected: false,
  devices: [],
  activeDevice: null,
  lastNoteOn: null,
  enabled: false,
  error: null,

  setConnected: (connected) => set({ connected }),
  setDevices: (devices) => set({ devices }),
  setActiveDevice: (device) => set({ activeDevice: device, connected: device !== null }),
  setLastNoteOn: (event) => set({ lastNoteOn: event }),
  setEnabled: (enabled) => set({ enabled }),
  setError: (error) => set({ error }),
}));
