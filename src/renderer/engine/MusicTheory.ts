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

export interface IntervalSpec {
  /** JP's short name, e.g. "m3". */
  short: string;
  /** Spoken name, e.g. "Minor 3rd". */
  name: string;
  /** Letter steps up from the root (a 3rd = 2). */
  steps: number;
  semitones: number;
}

/** The intervals JP assigned (musictheory.net, quality required): m2 through P8. */
export const JP_INTERVALS: IntervalSpec[] = [
  { short: 'm2', name: 'Minor 2nd', steps: 1, semitones: 1 },
  { short: 'M2', name: 'Major 2nd', steps: 1, semitones: 2 },
  { short: 'm3', name: 'Minor 3rd', steps: 2, semitones: 3 },
  { short: 'M3', name: 'Major 3rd', steps: 2, semitones: 4 },
  { short: 'P4', name: 'Perfect 4th', steps: 3, semitones: 5 },
  { short: 'A4', name: 'Augmented 4th', steps: 3, semitones: 6 },
  { short: 'd5', name: 'Diminished 5th', steps: 4, semitones: 6 },
  { short: 'P5', name: 'Perfect 5th', steps: 4, semitones: 7 },
  { short: 'm6', name: 'Minor 6th', steps: 5, semitones: 8 },
  { short: 'M6', name: 'Major 6th', steps: 5, semitones: 9 },
  { short: 'm7', name: 'Minor 7th', steps: 6, semitones: 10 },
  { short: 'M7', name: 'Major 7th', steps: 6, semitones: 11 },
  { short: 'P8', name: 'Octave', steps: 7, semitones: 12 },
];

const LETTERS: NoteName[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

/**
 * The upper note of `interval` above a natural root, spelled by quality (F up an A4 is B,
 * B up a d5 is F, F up a P4 is Bb). From a natural root it never needs a double accidental.
 */
export function spellIntervalAbove(root: Pitch, interval: IntervalSpec): Pitch {
  const index = LETTERS.indexOf(root.note) + interval.steps;
  const note = LETTERS[index % 7];
  const octave = root.octave + Math.floor(index / 7);
  const diff = root.midiNumber + interval.semitones - pitchToMidiNumber(note, octave);
  const accidental: Accidental | undefined = diff === 1 ? 'sharp' : diff === -1 ? 'flat' : undefined;
  return { note, accidental, octave, midiNumber: root.midiNumber + interval.semitones };
}

/** Keys he played that were not asked for, spelled like the prompt (flats if it uses flats), low to high. */
export function wrongPitches(played: Iterable<number>, expected: number[], prompt: Pitch[]): Pitch[] {
  const flats = prompt.some((p) => p.accidental === 'flat');
  return [...new Set(played)].filter((n) => !expected.includes(n)).sort((a, b) => a - b).map((n) => midiNumberToPitch(n, flats));
}
