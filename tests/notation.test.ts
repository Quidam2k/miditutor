import { describe, expect, it } from 'vitest';
import {
  accidentalMark,
  clefForMidi,
  diatonicIndex,
  keyAlters,
  spellPlayed,
  staffOffsetSteps,
  writtenMidi,
  type WrittenNote,
} from '../src/shared/notation';

describe('keyAlters', () => {
  it('returns the alterations for G, D, F, Bb, and C major', () => {
    expect(keyAlters(1)).toEqual({
      C: 0, D: 0, E: 0, F: 1, G: 0, A: 0, B: 0,
    });
    expect(keyAlters(2)).toEqual({
      C: 1, D: 0, E: 0, F: 1, G: 0, A: 0, B: 0,
    });
    expect(keyAlters(-1)).toEqual({
      C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: -1,
    });
    expect(keyAlters(-2)).toEqual({
      C: 0, D: 0, E: -1, F: 0, G: 0, A: 0, B: -1,
    });
    expect(keyAlters(0)).toEqual({
      C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0,
    });
  });

  it('supports all seven sharps and flats', () => {
    expect(Object.values(keyAlters(7))).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(Object.values(keyAlters(-7))).toEqual([-1, -1, -1, -1, -1, -1, -1]);
  });
});

describe('writtenMidi', () => {
  it('uses the written letter octave across pitch boundaries', () => {
    expect(writtenMidi({ letter: 'B', alter: 1, octave: 3 })).toBe(60);
    expect(writtenMidi({ letter: 'C', alter: -1, octave: 5 })).toBe(71);
  });
});

describe('spellPlayed', () => {
  it('preserves an exact written Bb4 in F major', () => {
    const written: WrittenNote = { letter: 'B', alter: -1, octave: 4 };

    expect(spellPlayed(70, -1, [written])).toEqual(written);
  });

  it('spells F5 against written F#5 as F natural', () => {
    expect(spellPlayed(77, 1, [
      { letter: 'F', alter: 1, octave: 5 },
    ])).toEqual({ letter: 'F', alter: 0, octave: 5 });
  });

  it('spells chromatic C#4 in C major with a sharp', () => {
    expect(spellPlayed(61, 0, [])).toEqual({
      letter: 'C', alter: 1, octave: 4,
    });
  });

  it('spells MIDI 63 beside written E4 as Eb4 in F major', () => {
    expect(spellPlayed(63, -1, [
      { letter: 'E', alter: 0, octave: 4 },
    ])).toEqual({ letter: 'E', alter: -1, octave: 4 });
  });

  it('uses key-signature spellings before chromatic defaults', () => {
    expect(spellPlayed(66, 1, [])).toEqual({
      letter: 'F', alter: 1, octave: 4,
    });
    expect(spellPlayed(70, -1, [])).toEqual({
      letter: 'B', alter: -1, octave: 4,
    });
  });

  it('uses flats for chromatic pitches in a flat key', () => {
    expect(spellPlayed(61, -1, [])).toEqual({
      letter: 'D', alter: -1, octave: 4,
    });
  });

  it('prefers an exact match over an earlier neighbour', () => {
    expect(spellPlayed(63, 0, [
      { letter: 'E', alter: 0, octave: 4 },
      { letter: 'D', alter: 1, octave: 4 },
    ])).toEqual({ letter: 'D', alter: 1, octave: 4 });
  });

  it('uses the first eligible neighbour on a pitch-distance tie', () => {
    expect(spellPlayed(61, 0, [
      { letter: 'D', alter: 0, octave: 4 },
      { letter: 'C', alter: 0, octave: 4 },
    ])).toEqual({ letter: 'D', alter: -1, octave: 4 });
  });

  it('skips neighbours that would require a double accidental', () => {
    expect(spellPlayed(62, 0, [
      { letter: 'C', alter: 1, octave: 4 },
    ])).toEqual({ letter: 'D', alter: 0, octave: 4 });
  });

  it('computes key-signature octaves from the letter', () => {
    expect(spellPlayed(60, 7, [])).toEqual({
      letter: 'B', alter: 1, octave: 3,
    });
    expect(spellPlayed(71, -7, [])).toEqual({
      letter: 'C', alter: -1, octave: 5,
    });
  });
});

describe('staff placement', () => {
  it('gives C4 diatonic index 28', () => {
    expect(diatonicIndex({ letter: 'C', octave: 4 })).toBe(28);
  });

  it('counts steps below the treble top line', () => {
    expect(staffOffsetSteps({ letter: 'F', alter: 0, octave: 5 }, 'treble')).toBe(0);
    expect(staffOffsetSteps({ letter: 'E', alter: 0, octave: 5 }, 'treble')).toBe(1);
    expect(staffOffsetSteps({ letter: 'E', alter: 0, octave: 4 }, 'treble')).toBe(8);
    expect(staffOffsetSteps({ letter: 'C', alter: 0, octave: 4 }, 'treble')).toBe(10);
  });

  it('counts steps below the bass top line', () => {
    expect(staffOffsetSteps({ letter: 'A', alter: 0, octave: 3 }, 'bass')).toBe(0);
    expect(staffOffsetSteps({ letter: 'G', alter: 0, octave: 2 }, 'bass')).toBe(8);
  });
});

describe('accidentalMark', () => {
  it('marks F natural against written F#5 in G major', () => {
    expect(accidentalMark(
      { letter: 'F', alter: 0, octave: 5 },
      1,
      [{ letter: 'F', alter: 1, octave: 5 }],
    )).toBe('natural');
  });

  it('marks B natural against written Bb4 in F major', () => {
    expect(accidentalMark(
      { letter: 'B', alter: 0, octave: 4 },
      -1,
      [{ letter: 'B', alter: -1, octave: 4 }],
    )).toBe('natural');
  });

  it('marks C#4 against written C4 in C major', () => {
    expect(accidentalMark(
      { letter: 'C', alter: 1, octave: 4 },
      0,
      [{ letter: 'C', alter: 0, octave: 4 }],
    )).toBe('sharp');
  });

  it('marks Eb4 against written E4', () => {
    expect(accidentalMark(
      { letter: 'E', alter: -1, octave: 4 },
      -1,
      [{ letter: 'E', alter: 0, octave: 4 }],
    )).toBe('flat');
  });

  it('never marks an exact written match', () => {
    const played: WrittenNote = { letter: 'C', alter: 1, octave: 4 };

    expect(accidentalMark(played, 0, [played])).toBeNull();
    expect(accidentalMark(played, 0, [
      { letter: 'C', alter: 0, octave: 4 },
      played,
    ])).toBeNull();
  });

  it('marks F natural in G major without a written F', () => {
    expect(accidentalMark(
      { letter: 'F', alter: 0, octave: 5 },
      1,
      [{ letter: 'G', alter: 0, octave: 4 }],
    )).toBe('natural');
  });

  it('does not mark G4 in G major', () => {
    expect(accidentalMark(
      { letter: 'G', alter: 0, octave: 4 },
      1,
      [],
    )).toBeNull();
  });

  it('compares written accidentals only at the same octave', () => {
    expect(accidentalMark(
      { letter: 'F', alter: 0, octave: 5 },
      1,
      [{ letter: 'F', alter: 0, octave: 4 }],
    )).toBe('natural');
  });

  it('returns null for unsupported alterations', () => {
    expect(accidentalMark(
      { letter: 'C', alter: 2, octave: 4 },
      0,
      [{ letter: 'C', alter: 0, octave: 4 }],
    )).toBeNull();
  });
});

describe('clefForMidi', () => {
  it('splits a two-staff part at MIDI 60', () => {
    expect(clefForMidi(59, 2)).toBe('bass');
    expect(clefForMidi(60, 2)).toBe('treble');
  });

  it('uses treble for a single staff', () => {
    expect(clefForMidi(36, 1)).toBe('treble');
  });
});

describe('accidentalMark only where the key implies one', () => {
  it('does not mark a chromatic miss on a letter the key leaves natural', () => {
    const played = { letter: 'C' as const, alter: 1, octave: 5 };
    expect(accidentalMark(played, 0, [{ letter: 'E', alter: 0, octave: 4 }])).toBeNull();
  });
});

describe('key-altered letter played natural', () => {
  it('spells F4 in G major as F natural and marks it', () => {
    const written = [{ letter: 'A' as const, alter: 0, octave: 4 }];
    const played = spellPlayed(65, 1, written);
    expect(played).toEqual({ letter: 'F', alter: 0, octave: 4 });
    expect(accidentalMark(played, 1, written)).toBe('natural');
  });
  it('spells Bb in D major... B natural in F major as B natural', () => {
    expect(spellPlayed(71, -1, [])).toEqual({ letter: 'B', alter: 0, octave: 4 });
  });
});
