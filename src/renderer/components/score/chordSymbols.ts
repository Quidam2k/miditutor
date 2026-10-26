// Chord symbols printed above the staff (<harmony>, #9506): which pitch classes
// make the chord, and whether what he has played covers them.

const mod12 = (n: number) => ((n % 12) + 12) % 12;

// Intervals above the root, keyed by OSMD's ChordSymbolEnum value.
const KIND_INTERVALS: Record<number, number[]> = {
  0: [0, 4, 7], // major
  1: [0, 3, 7], // minor
  2: [0, 4, 8], // augmented
  3: [0, 3, 6], // diminished
  4: [0, 4, 7, 10], // dominant
  5: [0, 4, 7, 11], // major-seventh
  6: [0, 3, 7, 10], // minor-seventh
  7: [0, 3, 6, 9], // diminished-seventh
  9: [0, 3, 6, 10], // half-diminished
  11: [0, 4, 7, 9], // major-sixth
  12: [0, 3, 7, 9], // minor-sixth
  // Ninths: the fifth is often left out, so the root, third, seventh and ninth.
  13: [0, 4, 10, 2], // dominant-ninth
  22: [0, 2, 7], // suspended-second
  23: [0, 5, 7], // suspended-fourth
  29: [0, 7], // power
};

const KIND_SUFFIX: Record<number, string> = {
  0: '', 1: 'm', 2: '+', 3: 'dim', 4: '7', 5: 'maj7', 6: 'm7', 7: 'dim7', 9: 'm7b5',
  11: '6', 12: 'm6', 13: '9', 22: 'sus2', 23: 'sus4', 29: '5',
};

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

export interface ChordSymbol {
  /** Pitch classes that make the chord; the bass note of a slash chord is included. */
  pcs: number[];
  /** For logs, e.g. "G/B". */
  label: string;
}

/** null for a kind we don't model (Neapolitan, 11ths, ...): it is never highlighted. */
export function chordSymbol(rootPc: number, kind: number, bassPc?: number): ChordSymbol | null {
  const intervals = KIND_INTERVALS[kind];
  if (!intervals) return null;
  const pcs = new Set(intervals.map((i) => mod12(rootPc + i)));
  if (bassPc !== undefined) pcs.add(mod12(bassPc));
  const bass = bassPc !== undefined && mod12(bassPc) !== mod12(rootPc) ? `/${NAMES[mod12(bassPc)]}` : '';
  return { pcs: [...pcs], label: `${NAMES[mod12(rootPc)]}${KIND_SUFFIX[kind]}${bass}` };
}

/** True once every pitch class of the chord is among the MIDI notes played. Octave and order don't matter. */
export function playsChord(chord: ChordSymbol, midis: Iterable<number>): boolean {
  const played = new Set([...midis].map(mod12));
  return chord.pcs.every((pc) => played.has(pc));
}
