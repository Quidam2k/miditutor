export type NoteName = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
export type Accidental = 'sharp' | 'flat' | 'natural';
export type Clef = 'treble' | 'bass';

export interface Pitch {
  note: NoteName;
  accidental?: Accidental;
  octave: number; // middle C = C4
  midiNumber: number; // middle C = 60
}

export interface MasteryRecord {
  midiNumber: number;
  attempts: number;
  correct: number;
  recentResults: boolean[]; // last N results for rolling accuracy
  mastered: boolean; // >90% accuracy over last 10
}
