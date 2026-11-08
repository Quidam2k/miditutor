// #5652 A landmark ladder: start on the landmark notes (middle C, treble G, bass F, the Cs a space
// away), and add the next-nearest note one at a time once every note in the set is fast and right.
// Pure logic; the level only ever goes up.
import { Clef } from '../types/music';
import { NoteStat, NoteStats, TrainerClef, TrainerNote, notePool } from './NoteTrainer';

export const LANDMARKS: Record<Clef, string[]> = { treble: ['C4', 'G4', 'C5'], bass: ['C3', 'F3', 'C4'] };
/** Right this many times running... */
export const LADDER_RUN = 3;
/** ...and at most this slow on average, to count as known. */
export const LADDER_FAST_MS = 3000;

export type LadderLevels = Partial<Record<TrainerClef, number>>;

const nameOf = (n: TrainerNote) => n.id.slice(n.id.indexOf(':') + 1);
const stepOf = (n: TrainerNote) => n.pitch.octave * 7 + 'CDEFGAB'.indexOf(n.pitch.note);

/** White keys in the order the ladder adds them: landmarks, then by distance (in letters) from the nearest one. */
export function ladderOrder(clef: TrainerClef): TrainerNote[] {
  const pool = notePool(clef, false);
  const marks = pool.filter((n) => LANDMARKS[n.clef].includes(nameOf(n)));
  const dist = (n: TrainerNote) => Math.min(...marks.filter((m) => m.clef === n.clef).map((m) => Math.abs(stepOf(m) - stepOf(n))));
  return pool
    .map((n) => ({ n, d: dist(n) }))
    .sort((a, b) => a.d - b.d || (a.n.clef === b.n.clef ? 0 : a.n.clef === 'treble' ? -1 : 1) || a.n.pitch.midiNumber - b.n.pitch.midiNumber)
    .map(({ n }) => n);
}

export const landmarkCount = (clef: TrainerClef) =>
  clef === 'both' ? LANDMARKS.treble.length + LANDMARKS.bass.length : LANDMARKS[clef].length;

export function isKnown(stat: NoteStat | undefined): boolean {
  if (!stat || stat.avgMs === null || stat.avgMs > LADDER_FAST_MS || stat.recent.length < LADDER_RUN) return false;
  return stat.recent.slice(-LADDER_RUN).every(Boolean);
}

/** How many notes of the order are in play: never fewer than stored, one more for each known prefix. */
export function ladderLevel(clef: TrainerClef, stats: NoteStats, stored = 0): number {
  const order = ladderOrder(clef);
  let k = Math.min(Math.max(stored, landmarkCount(clef)), order.length);
  while (k < order.length && order.slice(0, k).every((n) => isKnown(stats[n.id]))) k++;
  return k;
}

export function parseLadder(raw: unknown): LadderLevels {
  const out: LadderLevels = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const clef of ['treble', 'bass', 'both'] as const) {
    const v = (raw as Record<string, unknown>)[clef];
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0) out[clef] = v;
  }
  return out;
}
