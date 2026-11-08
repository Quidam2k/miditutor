// #5652 J interval cards: per-interval record for each clef ("treble:m3"), the picker that brings
// his slow and missed intervals back more often, and the "hardest intervals" list. Pure logic; the
// stats have the same shape as a note's (NoteTrainer), so recordAnswer and noteWeight apply as is.
import { Clef } from '../types/music';
import { IntervalSpec, JP_INTERVALS } from './MusicTheory';
import { NoteStats, noteWeight } from './NoteTrainer';

export const intervalId = (clef: Clef, short: string) => `${clef}:${short}`;
/** Fewer tries than this and an interval isn't called hard yet. */
export const HARD_MIN_TRIES = 3;

export function pickInterval(clef: Clef, stats: NoteStats, avoid?: string, rand: () => number = Math.random): IntervalSpec {
  const times = JP_INTERVALS.map((i) => stats[intervalId(clef, i.short)]?.avgMs).filter((v): v is number => typeof v === 'number');
  const s = [...times].sort((a, b) => a - b);
  const typical = s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
  const cands = JP_INTERVALS.filter((i) => i.short !== avoid);
  const weights = cands.map((i) => noteWeight(stats[intervalId(clef, i.short)], typical));
  let r = rand() * weights.reduce((a, b) => a + b, 0);
  for (let k = 0; k < cands.length; k++) {
    r -= weights[k];
    if (r < 0) return cands[k];
  }
  return cands[cands.length - 1];
}

export interface HardInterval { short: string; name: string; hitRate: number; avgMs: number | null; tries: number }

/** His weakest intervals in this clef: lowest recent hit rate first, then slowest. */
export function hardestIntervals(clef: Clef, stats: NoteStats, n = 3): HardInterval[] {
  const out: (HardInterval & { recentRate: number })[] = [];
  for (const i of JP_INTERVALS) {
    const s = stats[intervalId(clef, i.short)];
    if (!s || s.attempts < HARD_MIN_TRIES) continue;
    const recentRate = s.recent.length ? s.recent.filter(Boolean).length / s.recent.length : 1;
    out.push({ short: i.short, name: i.name, hitRate: s.hits / s.attempts, avgMs: s.avgMs, tries: s.attempts, recentRate });
  }
  out.sort((a, b) => a.recentRate - b.recentRate || (b.avgMs ?? Infinity) - (a.avgMs ?? Infinity) || a.short.localeCompare(b.short));
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return out.slice(0, n).map(({ recentRate, ...h }) => h);
}
