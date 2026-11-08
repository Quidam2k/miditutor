// #5652 I across-days review: each note he has answered gets a due day. Right and fast on a due
// note pushes it out (1, 2, 4 ... days); slow pulls it in; wrong makes it due today. Due notes
// ("faded") come up first. Pure logic; days are local 'YYYY-MM-DD' strings.
import { NoteStats, TrainerNote, pickNext } from './NoteTrainer';

export interface ReviewEntry { interval: number; due: string }
export type ReviewSchedule = Record<string, ReviewEntry>;

/** At most this slow (and right) to push a note out: the ladder's "known" bar. */
export const REVIEW_FAST_MS = 3000;
export const MAX_INTERVAL_DAYS = 60;
/** How often a due note is asked over the rest of the pool, while any are due. */
export const DUE_SHARE = 0.7;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/**
 * One answer. Untimed rights (the first note on the tab, names shown) don't move it; a fast right
 * only pushes a note out when it was due, so a run of rights in one sitting can't cram it to 60 days.
 */
export function recordReview(sched: ReviewSchedule, id: string, correct: boolean, ms: number | null, today: string): ReviewSchedule {
  const old = sched[id];
  let next: ReviewEntry;
  if (!correct) next = { interval: 0, due: today };
  else if (ms === null) return sched;
  else if (ms <= REVIEW_FAST_MS) {
    if (old && old.due > today) return sched;
    const interval = Math.min(MAX_INTERVAL_DAYS, Math.max(1, (old?.interval ?? 0) * 2));
    next = { interval, due: addDays(today, interval) };
  } else {
    const interval = Math.floor((old?.interval ?? 0) / 2);
    const due = addDays(today, Math.max(1, interval));
    next = { interval, due: old && old.due > today && old.due < due ? old.due : due };
  }
  return { ...sched, [id]: next };
}

export const isDue = (sched: ReviewSchedule, id: string, today: string): boolean => {
  const e = sched[id];
  return !!e && e.due <= today;
};

export function dueNotes(pool: TrainerNote[], sched: ReviewSchedule, today: string): TrainerNote[] {
  return pool.filter((n) => isDue(sched, n.id, today));
}

/** Due notes first (most of the time), with the usual slow/missed weighting among them. */
export function pickWithReview(
  pool: TrainerNote[], stats: NoteStats, sched: ReviewSchedule, today: string, avoidId?: string, rand: () => number = Math.random,
): TrainerNote | null {
  const due = dueNotes(pool, sched, today).filter((n) => n.id !== avoidId);
  if (!due.length || rand() >= DUE_SHARE) return null;
  return pickNext(due, stats, avoidId, rand);
}

export function parseReview(raw: unknown): ReviewSchedule {
  const out: ReviewSchedule = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (id === '__proto__' || !v || typeof v !== 'object') continue;
    const { interval, due } = v as Record<string, unknown>;
    if (typeof interval !== 'number' || !Number.isInteger(interval) || interval < 0 || interval > MAX_INTERVAL_DAYS) continue;
    if (typeof due !== 'string' || !DAY.test(due)) continue;
    out[id] = { interval, due };
  }
  return out;
}
