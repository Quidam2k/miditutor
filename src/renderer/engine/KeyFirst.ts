// #11354 (JP 10/9, upload 3634): name the accidentals first. Before reading in a new key he plays
// the key signature's sharps or flats (any octave, any order), so he has reasoned the key out
// before the first note, the way he talked his way through it for JP. Pure logic.

const SHARP_PCS = [6, 1, 8, 3, 10, 5, 0]; // F# C# G# D# A# E# B#
const FLAT_PCS = [10, 3, 8, 1, 6, 11, 4]; // Bb Eb Ab Db Gb Cb Fb
const SHARP_NAMES = ['F#', 'C#', 'G#', 'D#', 'A#', 'E#', 'B#'];
const FLAT_NAMES = ['Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb', 'Fb'];
/** Wrong keys before the names are shown. */
export const REVEAL_AFTER = 3;

export interface KeyGate {
  fifths: number;
  /** Pitch classes still to play, in signature order. */
  need: number[];
  got: number[];
  misses: number;
  /** The last key he pressed that isn't in the signature, for the red flash. */
  wrong: number | null;
}

const count = (fifths: number) => Math.min(Math.abs(Math.trunc(fifths)), 7);

export function accidentalNames(fifths: number): string[] {
  return (fifths > 0 ? SHARP_NAMES : FLAT_NAMES).slice(0, count(fifths));
}

/** Null for a signature with nothing in it: there is nothing to name. */
export function keyGate(fifths: number): KeyGate | null {
  const n = count(fifths);
  if (!n) return null;
  return { fifths, need: (fifths > 0 ? SHARP_PCS : FLAT_PCS).slice(0, n), got: [], misses: 0, wrong: null };
}

export type GateEvent = 'got' | 'again' | 'wrong' | 'done';

export function keyGateInput(g: KeyGate, midi: number): { gate: KeyGate; event: GateEvent } {
  const pc = ((midi % 12) + 12) % 12;
  if (g.got.includes(pc)) return { gate: { ...g, wrong: null }, event: 'again' };
  if (!g.need.includes(pc)) return { gate: { ...g, misses: g.misses + 1, wrong: pc }, event: 'wrong' };
  const gate = { ...g, need: g.need.filter((p) => p !== pc), got: [...g.got, pc], wrong: null };
  return { gate, event: gate.need.length ? 'got' : 'done' };
}

export const gateDone = (g: KeyGate | null) => !g || g.need.length === 0;

/** "play its 3 flats" / "play its sharp". */
export function gateAsk(fifths: number): string {
  const n = count(fifths);
  const kind = fifths > 0 ? 'sharp' : 'flat';
  return n === 1 ? `play its ${kind}` : `play its ${n} ${kind}s`;
}

/** The names he has played so far, in signature order; all of them once he has missed enough. */
export function gateShown(g: KeyGate): string[] {
  const names = accidentalNames(g.fifths);
  const pcs = (g.fifths > 0 ? SHARP_PCS : FLAT_PCS).slice(0, names.length);
  return names.map((name, i) => (g.got.includes(pcs[i]) || g.misses >= REVEAL_AFTER ? name : '?'));
}
