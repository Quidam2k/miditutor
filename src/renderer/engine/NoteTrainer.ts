// #5260 note-reading trainer: the note pool, per-note stats (hit rate + EWMA time), weighted
// next-note choice (slow and missed notes come up more), and the daily tally. Pure logic.
import { Clef, Pitch } from '../types/music';
import { MajorKey, midiNumberToPitch, pitchToDisplayName, printedAccidental, isWhiteKey } from './MusicTheory';

export type TrainerClef = Clef | 'both';
export const NOTE_RANGE: Record<Clef, [number, number]> = { treble: [60, 81], bass: [40, 60] };
export const TIME_CAP_MS = 10_000;
const UNSEEN_WEIGHT = 3;
const RECENT_KEEP = 8;
const EWMA_NEW = 0.3;

export interface TrainerNote { id: string; clef: Clef; pitch: Pitch } // id like "treble:Gb4"
export interface NoteStat { attempts: number; hits: number; avgMs: number | null; recent: boolean[] }
export type NoteStats = Record<string, NoteStat>;
export interface DayTally { day: string; attempts: number; hits: number; hitMs: number; timedHits: number }

const clefNotes = (clef: Clef, accidentals: boolean): TrainerNote[] => {
  const [lo, hi] = NOTE_RANGE[clef];
  const out: TrainerNote[] = [];
  const add = (pitch: Pitch) => out.push({ id: `${clef}:${pitchToDisplayName(pitch)}`, clef, pitch });
  for (let n = lo; n <= hi; n++) {
    if (isWhiteKey(n)) add(midiNumberToPitch(n));
    else if (accidentals) {
      add(midiNumberToPitch(n));
      add(midiNumberToPitch(n, true));
    }
  }
  return out;
};

export function notePool(clef: TrainerClef, accidentals: boolean): TrainerNote[] {
  if (clef === 'both') return [...clefNotes('treble', accidentals), ...clefNotes('bass', accidentals)];
  return clefNotes(clef, accidentals);
}

// #10262: up to 5 sharps or flats, the keys whose scales need no E#, B#, Cb or Fb (not in the pool).
export const TRAINER_KEYS: MajorKey[] = [
  { name: 'C', fifths: 0 }, { name: 'G', fifths: 1 }, { name: 'D', fifths: 2 }, { name: 'A', fifths: 3 },
  { name: 'E', fifths: 4 }, { name: 'B', fifths: 5 }, { name: 'F', fifths: -1 }, { name: 'Bb', fifths: -2 },
  { name: 'Eb', fifths: -3 }, { name: 'Ab', fifths: -4 }, { name: 'Db', fifths: -5 },
];
/** Notes drawn before the key changes, so he reads in it rather than re-reading a signature each time. */
export const KEY_HOLD_NOTES = 8;
const OUT_OF_KEY_SHARE = 0.2;

export function pickKey(avoid?: MajorKey | null, rand: () => number = Math.random): MajorKey {
  const rest = TRAINER_KEYS.filter((k) => k.name !== avoid?.name);
  return rest[Math.min(Math.floor(rand() * rest.length), rest.length - 1)];
}

/**
 * The notes a key can ask: its own, printed bare, and the rest of the keyboard with the accidental
 * they need. A key on the scale is only ever its scale spelling: no Gb in D major, where that's F#.
 */
export function keyPool(clef: TrainerClef, key: MajorKey): { inKey: TrainerNote[]; outOfKey: TrainerNote[] } {
  const all = notePool(clef, true);
  const inKey = all.filter((n) => printedAccidental(n.pitch, key.fifths) === null);
  const scale = new Set(inKey.map((n) => n.pitch.midiNumber % 12));
  return { inKey, outOfKey: all.filter((n) => !scale.has(n.pitch.midiNumber % 12)) };
}

/** Mostly the key's own notes; the weighting by speed and misses applies inside each half. */
export function pickInKey(clef: TrainerClef, key: MajorKey, stats: NoteStats, avoidId?: string, rand: () => number = Math.random): TrainerNote {
  const { inKey, outOfKey } = keyPool(clef, key);
  return pickNext(rand() < OUT_OF_KEY_SHARE ? outOfKey : inKey, stats, avoidId, rand);
}

export function recordAnswer(stats: NoteStats, id: string, correct: boolean, ms: number | null): NoteStats {
  const old = stats[id] ?? { attempts: 0, hits: 0, avgMs: null, recent: [] };
  let avgMs = old.avgMs;
  if (correct && ms !== null) {
    const t = Math.min(Math.max(ms, 0), TIME_CAP_MS);
    avgMs = old.avgMs === null ? t : EWMA_NEW * t + (1 - EWMA_NEW) * old.avgMs;
  }
  return {
    ...stats,
    [id]: {
      attempts: old.attempts + 1,
      hits: old.hits + (correct ? 1 : 0),
      avgMs,
      recent: [...old.recent, correct].slice(-RECENT_KEEP),
    },
  };
}

/** How much he should see this note: unseen, slow and often-missed notes weigh more. Always > 0. */
export function noteWeight(stat: NoteStat | undefined, typicalMs: number | null): number {
  if (!stat || stat.attempts === 0) return UNSEEN_WEIGHT;
  const misses = stat.recent.filter((r) => !r).length;
  const missFactor = 1 + 4 * (stat.recent.length ? misses / stat.recent.length : 0);
  let timeFactor: number;
  if (stat.avgMs === null) timeFactor = 2;
  else if (typicalMs === null || typicalMs <= 0) timeFactor = 1;
  else timeFactor = Math.min(6, Math.max(0.25, (stat.avgMs / typicalMs) ** 2));
  return timeFactor * missFactor;
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function pickNext(pool: TrainerNote[], stats: NoteStats, avoidId?: string, rand: () => number = Math.random): TrainerNote {
  if (!pool.length) throw new Error('pickNext: empty pool');
  const times = pool.map((n) => stats[n.id]?.avgMs).filter((v): v is number => typeof v === 'number');
  const typicalMs = median(times);
  const rest = pool.filter((n) => n.id !== avoidId);
  const cands = rest.length ? rest : pool;
  const weights = cands.map((n) => noteWeight(stats[n.id], typicalMs));
  let r = rand() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < cands.length; i++) {
    r -= weights[i];
    if (r < 0) return cands[i];
  }
  return cands[cands.length - 1];
}

export function slowestNotes(stats: NoteStats, n: number): { id: string; name: string; clef: Clef; avgMs: number; hitRate: number; attempts: number }[] {
  const out: { id: string; name: string; clef: Clef; avgMs: number; hitRate: number; attempts: number }[] = [];
  for (const [id, s] of Object.entries(stats)) {
    const m = /^(treble|bass):(.+)$/.exec(id);
    if (!m || s.avgMs === null) continue;
    out.push({ id, name: m[2], clef: m[1] as Clef, avgMs: s.avgMs, hitRate: s.attempts ? s.hits / s.attempts : 0, attempts: s.attempts });
  }
  out.sort((a, b) => b.avgMs - a.avgMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out.slice(0, n);
}

export function recordDay(tally: DayTally | null, day: string, correct: boolean, ms: number | null): DayTally {
  const t = tally && tally.day === day ? tally : { day, attempts: 0, hits: 0, hitMs: 0, timedHits: 0 };
  const timed = correct && ms !== null;
  return {
    day,
    attempts: t.attempts + 1,
    hits: t.hits + (correct ? 1 : 0),
    hitMs: t.hitMs + (timed ? Math.min(Math.max(ms, 0), TIME_CAP_MS) : 0),
    timedHits: t.timedHits + (timed ? 1 : 0),
  };
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** Stored stats are untrusted JSON: keep only well-formed entries, copying just the four fields. */
export function parseNoteStats(raw: unknown): NoteStats {
  const out: NoteStats = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (id === '__proto__' || !v || typeof v !== 'object') continue;
    const { attempts, hits, avgMs, recent } = v as Record<string, unknown>;
    if (!isCount(attempts) || !isCount(hits) || hits > attempts) continue;
    if (avgMs !== null && !(typeof avgMs === 'number' && Number.isFinite(avgMs) && avgMs >= 0)) continue;
    if (Array.isArray(recent) && !recent.every((r) => typeof r === 'boolean')) continue;
    out[id] = { attempts, hits, avgMs, recent: Array.isArray(recent) ? (recent as boolean[]).slice(-RECENT_KEEP) : [] };
  }
  return out;
}

const isNonNeg = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

export function parseDayTally(raw: unknown): DayTally | null {
  if (!raw || typeof raw !== 'object') return null;
  const { day, attempts, hits, hitMs, timedHits } = raw as Record<string, unknown>;
  if (typeof day !== 'string' || !isNonNeg(attempts) || !isNonNeg(hits) || !isNonNeg(hitMs) || !isNonNeg(timedHits)) return null;
  return { day, attempts, hits, hitMs, timedHits };
}
