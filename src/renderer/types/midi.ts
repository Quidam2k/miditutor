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
