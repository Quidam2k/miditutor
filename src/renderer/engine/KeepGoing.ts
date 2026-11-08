// Keep going (#5652 K): a fixed-tempo pass through the piece or loop. The cursor
// moves on the beat whether he plays or not; each step's notes count only while
// it is the step under the cursor, and nothing waits for him. JP 8/26: "it's very
// useful to have [the metronome] at your back"; 9/11: go up a few clicks at a time.
import type { ScoreStep } from './ScoreFollower';

/** A note this far before a step's beat still counts for that step (an early hit). */
export const EARLY_MS = 120;
/** The early window never takes more than this share of the step before. */
const EARLY_SHARE = 0.4;
/** JP 9/11: "go up in 4s". */
export const STEP_UP_BPM = 4;
/** A lap this good earns the next lap STEP_UP_BPM more. */
const STEP_UP_HIT = 0.9;
const STEP_UP_WRONG = 0.1;
export const MIN_BPM = 20;
export const MAX_BPM = 240;

export interface KeepRun {
  first: number;
  last: number;
  bpm: number;
  /** Clock time of the first step's beat in this lap. */
  startMs: number;
  lap: number;
  /** Notes he struck per step index, this lap. */
  struck: Map<number, Set<number>>;
  wrong: number;
  /** Wrong notes per bar, this lap. */
  wrongBars: Map<number, number>;
}

export interface KeepLap {
  lap: number;
  bpm: number;
  notes: number;
  hit: number;
  missed: number;
  wrong: number;
  /** Bars with the most missed + wrong notes, worst first (at most 3). */
  worstBars: { bar: number; missed: number; wrong: number }[];
  /** The tempo the next lap runs at. */
  nextBpm: number;
}

export const clampBpm = (bpm: number) => Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(bpm)));

export const beatMs = (bpm: number) => 60000 / bpm;

/** Quarter-note beats from the first step's beat to the end of the last step. */
export function lapBeats(steps: ScoreStep[], first: number, last: number): number {
  const end = steps[last + 1]?.beat ?? steps[last].beat + 1;
  return Math.max(end - steps[first].beat, 1e-6);
}

/** Beats in the first step's bar, for the count-in (4 when it can't be told). */
export function countInBeats(steps: ScoreStep[], first: number): number {
  const bar = steps[first]?.measure;
  if (bar === undefined) return 4;
  const start = steps.find((s) => s.measure === bar)?.beat;
  const next = steps.find((s) => s.measure === bar + 1)?.beat;
  if (start === undefined || next === undefined) return 4;
  const beats = Math.round(next - start);
  return beats >= 2 && beats <= 12 ? beats : 4;
}

export function startKeep(first: number, last: number, bpm: number, startMs: number): KeepRun {
  return { first, last, bpm: clampBpm(bpm), startMs, lap: 1, struck: new Map(), wrong: 0, wrongBars: new Map() };
}

const stepStart = (run: KeepRun, steps: ScoreStep[], i: number) =>
  run.startMs + (steps[i].beat - steps[run.first].beat) * beatMs(run.bpm);

export const lapEndMs = (run: KeepRun, steps: ScoreStep[]) =>
  run.startMs + lapBeats(steps, run.first, run.last) * beatMs(run.bpm);

/** The step under the cursor at clock time t: -1 before the lap, last after it. */
export function stepAt(run: KeepRun, steps: ScoreStep[], t: number): number {
  if (t < run.startMs) return -1;
  let i = run.first;
  while (i < run.last && stepStart(run, steps, i + 1) <= t) i++;
  return i;
}

/** He struck midi at time t: a hit for the step it belongs to, or a wrong note. */
export function keepNote(run: KeepRun, steps: ScoreStep[], midi: number, t: number): 'hit' | 'wrong' | 'ignored' {
  const i = stepAt(run, steps, t);
  const has = (j: number) => j >= run.first && j <= run.last && steps[j].notes.includes(midi) && !run.struck.get(j)?.has(midi);
  const strike = (j: number) => {
    const set = run.struck.get(j) ?? new Set<number>();
    set.add(midi);
    run.struck.set(j, set);
    return 'hit' as const;
  };
  // Early for the next step (or the first step, during the count-in's last moment).
  const next = i < 0 ? run.first : i + 1;
  if (next <= run.last) {
    const before = next > run.first ? stepStart(run, steps, next) - stepStart(run, steps, next - 1) : Infinity;
    const early = Math.min(EARLY_MS, before * EARLY_SHARE);
    if (stepStart(run, steps, next) - t <= early && has(next) && !(i >= 0 && has(i))) return strike(next);
  }
  if (i < 0) return 'ignored';
  if (has(i)) return strike(i);
  // A held-over or tied note re-struck isn't wrong; nor is repeating a note he just hit.
  if (steps[i].ringing?.includes(midi) || run.struck.get(i)?.has(midi)) return 'ignored';
  run.wrong++;
  const bar = steps[i].measure;
  run.wrongBars.set(bar, (run.wrongBars.get(bar) ?? 0) + 1);
  return 'wrong';
}

/** Close the lap that ended: its tally, and the run reset for the next lap. */
export function closeLap(run: KeepRun, steps: ScoreStep[], stepUp: boolean, capBpm?: number): KeepLap {
  let notes = 0;
  let hit = 0;
  const bars = new Map<number, { missed: number; wrong: number }>();
  for (let i = run.first; i <= run.last; i++) {
    const struck = run.struck.get(i);
    for (const n of steps[i].notes) {
      notes++;
      if (struck?.has(n)) hit++;
      else {
        const b = bars.get(steps[i].measure) ?? { missed: 0, wrong: 0 };
        b.missed++;
        bars.set(steps[i].measure, b);
      }
    }
  }
  for (const [bar, wrong] of run.wrongBars) {
    const b = bars.get(bar) ?? { missed: 0, wrong: 0 };
    b.wrong = wrong;
    bars.set(bar, b);
  }
  const worstBars = [...bars.entries()]
    .map(([bar, b]) => ({ bar, ...b }))
    .sort((a, b) => b.missed + b.wrong - (a.missed + a.wrong) || a.bar - b.bar)
    .slice(0, 3);
  const clean = notes > 0 && hit / notes >= STEP_UP_HIT && run.wrong <= notes * STEP_UP_WRONG;
  let nextBpm = run.bpm;
  if (stepUp && clean) {
    // Never past the piece's target tempo, never down because of it.
    const up = run.bpm + STEP_UP_BPM;
    nextBpm = clampBpm(capBpm ? Math.max(run.bpm, Math.min(capBpm, up)) : up);
  }
  const lap: KeepLap = { lap: run.lap, bpm: run.bpm, notes, hit, missed: notes - hit, wrong: run.wrong, worstBars, nextBpm };
  run.startMs = lapEndMs(run, steps);
  run.bpm = nextBpm;
  run.lap++;
  run.struck = new Map();
  run.wrong = 0;
  run.wrongBars = new Map();
  return lap;
}

/** "Lap 2 at ♩ = 60: 41 of 48 notes, 3 wrong. Most misses: bar 5 (4), bar 7 (2)." */
export function lapLabel(l: KeepLap): string {
  const worst = l.worstBars.filter((b) => b.missed + b.wrong > 0);
  const tail = worst.length ? ` Most misses: ${worst.map((b) => `bar ${b.bar} (${b.missed + b.wrong})`).join(', ')}.` : ' Every note!';
  const up = l.nextBpm > l.bpm ? ` Next lap ♩ = ${l.nextBpm}.` : '';
  return `Lap ${l.lap} at ♩ = ${l.bpm}: ${l.hit} of ${l.notes} notes, ${l.wrong} wrong.${tail}${up}`;
}
