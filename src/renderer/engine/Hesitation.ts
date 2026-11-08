// #5652 E hesitation fingerprint: his Notes times sliced by clef, where the note sits (staff or
// ledger lines), the accidental printed beside it, and the kind of key, so the panel can name the
// three places he is slowest ("bass clef", "ledger lines below", "flat keys"). Pure logic.
import { Clef, Pitch } from '../types/music';
import { MajorKey, printedAccidental } from './MusicTheory';
import { TIME_CAP_MS } from './NoteTrainer';

export interface Slice { n: number; avgMs: number }
export type Slices = Record<string, Slice>;

/** Below this many timed hits a slice isn't shown: a couple of slow notes aren't a pattern. */
export const MIN_SLICE_HITS = 8;
/** A plain mean for the first answers, then a slow moving average so old weeks fade. */
const EWMA_FLOOR = 0.05;
export const ALL = 'all';

export const SLICE_LABELS: Record<string, string> = {
  'clef:treble': 'treble clef',
  'clef:bass': 'bass clef',
  'pos:staff': 'on the staff',
  'pos:above': 'ledger lines above',
  'pos:below': 'ledger lines below',
  'acc:none': 'no accidental',
  'acc:sharp': 'a sharp beside it',
  'acc:flat': 'a flat beside it',
  'acc:natural': 'a natural sign beside it',
  'key:none': 'no key signature',
  'key:sharp': 'sharp keys',
  'key:flat': 'flat keys',
};

/** Diatonic steps outside the staff: the top and bottom lines are 0. */
export function stepsOffStaff(pitch: Pitch, clef: Clef): number {
  const step = pitch.octave * 7 + 'CDEFGAB'.indexOf(pitch.note);
  const [bottom, top] = clef === 'treble' ? [4 * 7 + 2, 5 * 7 + 3] : [2 * 7 + 4, 3 * 7 + 5]; // E4-F5, G2-A3
  return Math.max(bottom - step, step - top, 0);
}

/** The slices one asked note falls in. Two steps off the staff is the first ledger line. */
export function sliceKeys(pitch: Pitch, clef: Clef, key: MajorKey | null): string[] {
  const step = pitch.octave * 7 + 'CDEFGAB'.indexOf(pitch.note);
  const off = stepsOffStaff(pitch, clef);
  const above = step > (clef === 'treble' ? 5 * 7 + 3 : 3 * 7 + 5);
  const pos = off < 2 ? 'staff' : above ? 'above' : 'below';
  const printed = printedAccidental(pitch, key?.fifths ?? 0);
  const acc = printed === null ? 'none' : printed === '#' ? 'sharp' : printed === 'b' ? 'flat' : 'natural';
  const sig = !key || key.fifths === 0 ? 'none' : key.fifths > 0 ? 'sharp' : 'flat';
  return [`clef:${clef}`, `pos:${pos}`, `acc:${acc}`, `key:${sig}`];
}

/** A timed right answer, added to its slices and to ALL. Anything else leaves them alone. */
export function recordSlices(slices: Slices, keys: string[], correct: boolean, ms: number | null): Slices {
  if (!correct || ms === null) return slices;
  const t = Math.min(Math.max(ms, 0), TIME_CAP_MS);
  const out = { ...slices };
  for (const k of [ALL, ...keys]) {
    const old = out[k];
    const n = (old?.n ?? 0) + 1;
    const a = Math.max(1 / n, EWMA_FLOOR);
    out[k] = { n, avgMs: old ? old.avgMs + a * (t - old.avgMs) : t };
  }
  return out;
}

export interface SlowSpot { key: string; label: string; avgMs: number; overMs: number; n: number }

/** The (up to) three slowest slices with enough answers, and how much slower each is than his usual. */
export function slowestSlices(slices: Slices, count = 3): SlowSpot[] {
  const all = slices[ALL];
  if (!all) return [];
  return Object.entries(slices)
    .filter(([k, s]) => k in SLICE_LABELS && s.n >= MIN_SLICE_HITS && s.avgMs > all.avgMs)
    .map(([k, s]) => ({ key: k, label: SLICE_LABELS[k], avgMs: s.avgMs, overMs: s.avgMs - all.avgMs, n: s.n }))
    .sort((a, b) => b.avgMs - a.avgMs || (a.key < b.key ? -1 : 1))
    .slice(0, count);
}

export function parseSlices(raw: unknown): Slices {
  const out: Slices = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k !== ALL && !(k in SLICE_LABELS)) continue;
    if (!v || typeof v !== 'object') continue;
    const { n, avgMs } = v as Record<string, unknown>;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) continue;
    if (typeof avgMs !== 'number' || !Number.isFinite(avgMs) || avgMs < 0) continue;
    out[k] = { n, avgMs };
  }
  return out;
}
