import { type Spelled } from './music';

export type WrittenNote = Spelled & { octave: number };

type Letter = Spelled['letter'];
type AccidentalMark = 'sharp' | 'flat' | 'natural' | null;

const LETTERS: readonly Letter[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const SHARP_ORDER: readonly Letter[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER: readonly Letter[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

const NATURAL_PC: Record<Letter, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

function pitchClass(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

function noteForMidi(midi: number, letter: Letter, alter: number): WrittenNote {
  return {
    letter,
    alter,
    // Subtract the alteration before finding the letter's octave.
    octave: (midi - NATURAL_PC[letter] - alter) / 12 - 1,
  };
}

export function writtenMidi(n: WrittenNote): number {
  return (n.octave + 1) * 12 + NATURAL_PC[n.letter] + n.alter;
}

export function keyAlters(fifths: number): Record<Letter, number> {
  const alters: Record<Letter, number> = {
    C: 0,
    D: 0,
    E: 0,
    F: 0,
    G: 0,
    A: 0,
    B: 0,
  };
  const order = fifths >= 0 ? SHARP_ORDER : FLAT_ORDER;
  const alter = fifths >= 0 ? 1 : -1;

  for (const [index, letter] of order.entries()) {
    if (index < Math.abs(fifths)) {
      alters[letter] = alter;
    }
  }

  return alters;
}

export function spellPlayed(
  midi: number,
  fifths: number,
  written: WrittenNote[],
): WrittenNote {
  for (const note of written) {
    if (writtenMidi(note) === midi) {
      return { ...note };
    }
  }

  for (const note of written) {
    const difference = midi - writtenMidi(note);
    const alter = note.alter + difference;

    // All eligible neighbours are one semitone away; the first wins ties.
    if (Math.abs(difference) === 1 && Math.abs(alter) <= 1) {
      return { letter: note.letter, alter, octave: note.octave };
    }
  }

  const alters = keyAlters(fifths);
  const pc = pitchClass(midi);

  for (const letter of LETTERS) {
    if (pitchClass(NATURAL_PC[letter] + alters[letter]) === pc) {
      return noteForMidi(midi, letter, alters[letter]);
    }
  }

  // A letter the key alters, played natural (F in G major): spell it as that
  // natural, so the red-natural rule can see it.
  for (const letter of LETTERS) {
    if (alters[letter] !== 0 && NATURAL_PC[letter] === pc) {
      return noteForMidi(midi, letter, 0);
    }
  }

  // The remaining pitches lie one semitone above or below a natural.
  const chromaticAlter = fifths >= 0 ? 1 : -1;

  for (const letter of LETTERS) {
    if (pitchClass(NATURAL_PC[letter] + chromaticAlter) === pc) {
      return noteForMidi(midi, letter, chromaticAlter);
    }
  }

  throw new RangeError('MIDI pitch must be an integer.');
}

export function diatonicIndex(n: { letter: Letter; octave: number }): number {
  return n.octave * 7 + 'CDEFGAB'.indexOf(n.letter);
}

export function staffOffsetSteps(
  n: WrittenNote,
  clef: 'treble' | 'bass',
): number {
  const topLine = clef === 'treble'
    ? diatonicIndex({ letter: 'F', octave: 5 })
    : diatonicIndex({ letter: 'A', octave: 3 });

  return topLine - diatonicIndex(n);
}

function markForAlter(alter: number): AccidentalMark {
  switch (alter) {
    case 0:
      return 'natural';
    case 1:
      return 'sharp';
    case -1:
      return 'flat';
    default:
      return null;
  }
}

export function accidentalMark(
  played: WrittenNote,
  fifths: number,
  written: WrittenNote[],
): AccidentalMark {
  const samePosition = written.filter(
    (note) => note.letter === played.letter && note.octave === played.octave,
  );

  // An exact written match takes precedence over conflicting accidentals.
  if (samePosition.some((note) => note.alter === played.alter)) {
    return null;
  }

  if (samePosition.length > 0) {
    return markForAlter(played.alter);
  }

  // Nothing written on that line/space: mark it only when the KEY alters this
  // letter and he played something else (Todd's rule), not every chromatic miss.
  const keyAlter = keyAlters(fifths)[played.letter];
  if (keyAlter !== 0 && played.alter !== keyAlter) {
    return markForAlter(played.alter);
  }

  return null;
}

export function clefForMidi(midi: number, staves: number): 'treble' | 'bass' {
  return staves === 1 || midi >= 60 ? 'treble' : 'bass';
}
