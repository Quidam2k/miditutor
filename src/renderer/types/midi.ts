export interface MidiDevice {
  id: string;
  name: string;
  manufacturer: string;
}

export interface MidiNoteEvent {
  note: number; // MIDI number 0-127
  velocity: number; // 0-127
  timestamp: number;
}

// One line in the MIDI monitor log. Covers both note-on and note-off so the
// monitor can show a full picture of what the keyboard is sending.
export interface MidiLogEntry {
  id: number; // monotonic, for React keys
  kind: 'noteon' | 'noteoff';
  note: number; // MIDI number 0-127
  noteName: string; // e.g. "C4", "F#3"
  velocity: number; // 0-127 (0 for note-off)
  channel: number; // 1-16
  source: 'hardware' | 'virtual';
  timestamp: number;
}
