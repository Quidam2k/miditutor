import { keyPitchClass, type ScaleType } from './Homework';

export type Hand = 'RH' | 'LH';

/** first and last are the outer tonics; cycle[0] is an inner tonic, cycle[1..6] are degrees 2..7. */
interface Pattern {
  first: number;
  cycle: number[];
  last: number;
}

type Table = Partial<Record<number, Partial<Record<Hand, Pattern>>>>;

const RH_WHITE: Pattern = { first: 1, cycle: [1, 2, 3, 1, 2, 3, 4], last: 5 };
const LH_WHITE: Pattern = { first: 5, cycle: [1, 4, 3, 2, 1, 3, 2], last: 1 };
const RH_F: Pattern = { first: 1, cycle: [1, 2, 3, 4, 1, 2, 3], last: 4 };
const LH_B: Pattern = { first: 4, cycle: [1, 3, 2, 1, 4, 3, 2], last: 1 };
const LH_FLAT: Pattern = { first: 3, cycle: [3, 2, 1, 4, 3, 2, 1], last: 3 };
const LH_F_SHARP: Pattern = { first: 4, cycle: [4, 3, 2, 1, 3, 2, 1], last: 4 };
const RH_SHARP_MINOR: Pattern = { first: 3, cycle: [3, 4, 1, 2, 3, 1, 2], last: 3 };

/** Keyed by pitch class, C = 0 ... B = 11. Per pianoscales.org/major.html. */
const MAJOR: Table = {
  0: { RH: RH_WHITE, LH: LH_WHITE }, // C
  1: { RH: { first: 2, cycle: [2, 3, 1, 2, 3, 4, 1], last: 2 }, LH: LH_FLAT }, // Db / C#
  2: { RH: RH_WHITE, LH: LH_WHITE }, // D
  3: { RH: { first: 3, cycle: [3, 1, 2, 3, 4, 1, 2], last: 3 }, LH: LH_FLAT }, // Eb / D#
  4: { RH: RH_WHITE, LH: LH_WHITE }, // E
  5: { RH: RH_F, LH: LH_WHITE }, // F
  6: { RH: { first: 2, cycle: [2, 3, 4, 1, 2, 3, 1], last: 2 }, LH: LH_F_SHARP }, // F# / Gb
  7: { RH: RH_WHITE, LH: LH_WHITE }, // G
  8: { RH: { first: 3, cycle: [3, 4, 1, 2, 3, 1, 2], last: 3 }, LH: LH_FLAT }, // Ab / G#
  9: { RH: RH_WHITE, LH: LH_WHITE }, // A
  10: { RH: { first: 2, cycle: [4, 1, 2, 3, 1, 2, 3], last: 4 }, LH: LH_FLAT }, // Bb / A#
  11: { RH: RH_WHITE, LH: LH_B }, // B
};

/** Per pianoscales.org/minor.html and colorinmypiano.com's two-octave chart. */
const NATURAL: Table = {
  0: { RH: RH_WHITE, LH: LH_WHITE }, // C
  1: { RH: RH_SHARP_MINOR, LH: LH_FLAT }, // C# / Db
  2: { RH: RH_WHITE, LH: LH_WHITE }, // D
  3: { // Eb / D#
    RH: { first: 3, cycle: [3, 1, 2, 3, 4, 1, 2], last: 3 },
    LH: { first: 2, cycle: [2, 1, 4, 3, 2, 1, 3], last: 2 },
  },
  4: { RH: RH_WHITE, LH: LH_WHITE }, // E
  5: { RH: RH_F, LH: LH_WHITE }, // F
  6: { RH: RH_SHARP_MINOR, LH: LH_F_SHARP }, // F# / Gb
  7: { RH: RH_WHITE, LH: LH_WHITE }, // G
  8: { RH: RH_SHARP_MINOR, LH: { first: 3, cycle: [3, 2, 1, 3, 2, 1, 4], last: 3 } }, // G# / Ab
  9: { RH: RH_WHITE, LH: LH_WHITE }, // A
  10: { // Bb / A#
    RH: { first: 2, cycle: [4, 1, 2, 3, 1, 2, 3], last: 4 },
    LH: { first: 2, cycle: [2, 1, 3, 2, 1, 4, 3], last: 2 },
  },
  11: { RH: RH_WHITE, LH: LH_B }, // B
};

/** Harmonic shares natural's patterns except G# LH. */
const HARMONIC: Table = {
  ...NATURAL,
  8: { RH: RH_SHARP_MINOR, LH: LH_FLAT },
};

/**
 * Melodic ascent; the way down uses NATURAL. Same as natural except G# LH.
 * C# and F# RH are left out on purpose: the going-up fingering wasn't settled by the charts we
 * could read, and a thumb on D#/A# is not something to guess at, so those show no numbers.
 */
const MELODIC: Table = {
  ...NATURAL,
  1: { LH: LH_FLAT },
  6: { LH: LH_F_SHARP },
  8: { RH: RH_SHARP_MINOR, LH: LH_FLAT },
};

const TABLES: Record<ScaleType, Table> = { major: MAJOR, natural: NATURAL, harmonic: HARMONIC, melodic: MELODIC };

function ascending(pattern: Pattern, octaves: number): number[] {
  const fingers = [pattern.first, ...pattern.cycle.slice(1)];
  for (let octave = 1; octave < octaves; octave++) fingers.push(...pattern.cycle);
  fingers.push(pattern.last);
  return fingers;
}

/**
 * Standard fingering, not JP's: one finger per note of scaleOffsets(type, octaves), up and back
 * down, the top tonic once. Null when there is no entry, so the drill shows no numbers.
 */
export function scaleFingers(key: string, type: ScaleType, hand: Hand, octaves = 2): number[] | null {
  if (!/^[A-Ga-g][#b]*$/.test(key)) return null;
  const pc = keyPitchClass(key);
  const pattern = TABLES[type]?.[pc]?.[hand];
  const downPattern = type === 'melodic' ? NATURAL[pc]?.[hand] : pattern;
  if (!pattern || !downPattern) return null;
  return [...ascending(pattern, octaves), ...ascending(downPattern, octaves).slice(0, -1).reverse()];
}
