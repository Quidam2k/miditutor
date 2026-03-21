import { NoteName, Accidental, Pitch } from '../types/music';

// Chromatic scale: each entry is [noteName, accidental?]
// We use sharps by default for black keys; flats used contextually
const CHROMATIC_SHARP: [NoteName, Accidental?][] = [
  ['C'], ['C', 'sharp'], ['D'], ['D', 'sharp'], ['E'],
  ['F'], ['F', 'sharp'], ['G'], ['G', 'sharp'], ['A'], ['A', 'sharp'], ['B'],
];

const CHROMATIC_FLAT: [NoteName, Accidental?][] = [
  ['C'], ['D', 'flat'], ['D'], ['E', 'flat'], ['E'],
  ['F'], ['G', 'flat'], ['G'], ['A', 'flat'], ['A'], ['B', 'flat'], ['B'],
];

// White key MIDI offsets within an octave
const NOTE_TO_SEMITONE: Record<NoteName, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

const ACCIDENTAL_OFFSET: Record<string, number> = {
  sharp: 1,
  flat: -1,
  natural: 0,
};

export function pitchToMidiNumber(note: NoteName, octave: number, accidental?: Accidental): number {
  const base = (octave + 1) * 12; // C-1 = MIDI 0, so C4 = (4+1)*12 = 60
  const semitone = NOTE_TO_SEMITONE[note];
  const offset = accidental ? ACCIDENTAL_OFFSET[accidental] : 0;
  return base + semitone + offset;
}

export function midiNumberToPitch(midiNumber: number, preferFlats = false): Pitch {
  const octave = Math.floor(midiNumber / 12) - 1;
  const semitone = midiNumber % 12;
  const chromatic = preferFlats ? CHROMATIC_FLAT : CHROMATIC_SHARP;
  const [note, accidental] = chromatic[semitone];
  return {
    note,
    accidental,
    octave,
    midiNumber,
  };
}

/**
 * Convert a Pitch to a VexFlow key string like "c/4", "c#/4", "bb/5"
 */
export function pitchToVexFlowKey(pitch: Pitch): string {
  const note = pitch.note.toLowerCase();
  let suffix = '';
  if (pitch.accidental === 'sharp') suffix = '#';
  else if (pitch.accidental === 'flat') suffix = 'b';
  return `${note}${suffix}/${pitch.octave}`;
}

/**
 * Get VexFlow accidental string for rendering
 */
export function getVexFlowAccidental(pitch: Pitch): string | null {
  if (pitch.accidental === 'sharp') return '#';
  if (pitch.accidental === 'flat') return 'b';
  return null;
}

/**
 * Check if two MIDI numbers are enharmonic equivalents
 * (they always are if they're the same number)
 */
export function isEnharmonicEquivalent(a: number, b: number): boolean {
  return a === b;
}

/**
 * Get the note name string for display (e.g. "C#4", "Bb3")
 */
export function pitchToDisplayName(pitch: Pitch): string {
  let acc = '';
  if (pitch.accidental === 'sharp') acc = '#';
  else if (pitch.accidental === 'flat') acc = 'b';
  return `${pitch.note}${acc}${pitch.octave}`;
}

/**
 * Check if a MIDI number is a white key
 */
export function isWhiteKey(midiNumber: number): boolean {
  const semitone = midiNumber % 12;
  return [0, 2, 4, 5, 7, 9, 11].includes(semitone);
}

/**
 * Get interval name between two MIDI numbers
 */
export function getIntervalName(semitones: number): string {
  const names: Record<number, string> = {
    0: 'Unison', 1: 'Minor 2nd', 2: 'Major 2nd', 3: 'Minor 3rd',
    4: 'Major 3rd', 5: 'Perfect 4th', 6: 'Tritone', 7: 'Perfect 5th',
    8: 'Minor 6th', 9: 'Major 6th', 10: 'Minor 7th', 11: 'Major 7th',
    12: 'Octave',
  };
  return names[Math.abs(semitones)] ?? `${Math.abs(semitones)} semitones`;
}
