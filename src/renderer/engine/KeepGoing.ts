// Keep going (#5652 K): a fixed-tempo pass through the piece or loop. The cursor
// moves on the beat whether he plays or not; each step's notes count only while
// it is the step under the cursor, and nothing waits for him. JP 8/26: "it's very
// useful to have [the metronome] at your back"; 9/11: go up a few clicks at a time.
import type { ScoreStep } from './ScoreFollower';
import { overrunNote, startOverrun, type Overrun } from './Overrun';

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
  /** #5945: the grace after the previous lap's end, for notes that play on past it. */
  over: Overrun | null;
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

/** Beats in the first step's bar, for the count-in (its time signature's; 4 when it can't be told). */
export function countInBeats(steps: ScoreStep[], first: number): number {
  const sig = steps[first]?.bar?.beats;
  if (sig !== undefined) return Math.max(2, Math.min(12, Math.round(sig)));
  const bar = steps[first]?.measure;
  if (bar === undefined) return 4;
  const start = steps.find((s) => s.measure === bar)?.beat;
  const next = steps.find((s) => s.measure === bar + 1)?.beat;
  if (start === undefined || next === undefined) return 4;
  const beats = Math.round(next - start);
  return beats >= 2 && beats <= 12 ? beats : 4;
}

/** One click: `rel` quarter-note beats from the lap's first step (negative = the count-in); `down` = the bar's accent. */
export interface Click { rel: number; down: boolean }

const EPS = 1e-6;

/**
 * #6587: the lap's click grid from each bar's real time signature. Clicks fall on quarter-note pulses
 * counted from the bar line, the accent on the bar's first pulse. A bar that is not a whole number of
 * quarters (3/8 = 1.5, 5/8 = 2.5) just goes quiet on its trailing half beat until the next bar's accent.
 * A piece's opening pickup bar counts its pulses back from its end, so the accent lands on the real downbeat.
 * Steps with no bar data (nothing to read) fall back to the first bar's length all the way through.
 */
export function lapClicks(steps: ScoreStep[], first: number, last: number): Click[] {
  const t0 = steps[first].beat;
  const span = lapBeats(steps, first, last);
  const out: Click[] = [];
  const seen = new Set<number>();
  let missing = false;
  for (let i = first; i <= last; i++) {
    const bar = steps[i].bar;
    if (!bar) { missing = true; break; }
    if (seen.has(bar.start)) continue;
    seen.add(bar.start);
    const add = (abs: number, down: boolean) => { if (abs >= t0 - EPS && abs < t0 + span - EPS) out.push({ rel: abs - t0, down }); };
    if (bar.start < EPS && bar.len < bar.beats - EPS) {
      for (let j = 1; bar.len - j >= -EPS; j++) add(bar.start + bar.len - j, false);
    } else {
      for (let k = 0; k < bar.len - EPS; k++) add(bar.start + k, k === 0);
    }
  }
  if (missing) {
    const count = countInBeats(steps, first);
    out.length = 0;
    for (let k = 0; k < span - EPS; k++) out.push({ rel: k, down: k % count === 0 });
  }
  return out.sort((x, y) => x.rel - y.rel);
}

/** The count-in: one bar of the first step's length, its first click the accent. */
export function countInClicks(steps: ScoreStep[], first: number): Click[] {
  const n = countInBeats(steps, first);
  return Array.from({ length: n }, (_, j) => ({ rel: j - n, down: j === 0 }));
}

/** Climb's how-to card, plain words (#6598). The Roland line follows oddMeter: its click only in 4/4. */
export const CLIMB_HOW_TO = [
  'Climb plays your loop at a tempo that grows with you. Tick Climb and type the tempo (♩) you want to reach.',
  'Press Keep going. It starts at your last tempo here (or 70% of the target), counts you in, and clicks while you play.',
  'Clean laps move the tempo up; rough laps bring it down. Reach the target and it celebrates.',
  'The readout beside it shows the tempo now and who is clicking. The Roland piano clicks only when every bar of your loop is in 4/4 and Roland click is ticked in Practice settings; otherwise (3/4, 6/8, 9/8...) the app clicks.',
];

/** The first time signature in the loop (or its count-in bar) that is not 4/4, e.g. "6/8"; null if all 4/4 or unknown. */
export function oddMeter(steps: ScoreStep[], first: number, last: number): string | null {
  for (let i = first; i <= last; i++) {
    const sig = steps[i].bar?.sig;
    if (sig && sig !== '4/4') return sig;
  }
  return null;
}

export function startKeep(first: number, last: number, bpm: number, startMs: number): KeepRun {
  return { first, last, bpm: clampBpm(bpm), startMs, lap: 1, struck: new Map(), wrong: 0, wrongBars: new Map(), over: null };
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
export function keepNote(run: KeepRun, steps: ScoreStep[], midi: number, t: number): 'hit' | 'wrong' | 'overrun' | 'ignored' {
  const i = stepAt(run, steps, t);
  const has = (j: number) => j >= run.first && j <= run.last && steps[j].notes.includes(midi) && !run.struck.get(j)?.has(midi);
  const strike = (j: number) => {
    const set = run.struck.get(j) ?? new Set<number>();
    set.add(midi);
    run.struck.set(j, set);
    // #5945: it may be the note the piece carries on with too (C C D ...): count it there as well.
    overrunNote(run.over, steps, midi, t);
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
  // #5945: the piece carrying on past the loop's end: it thuds, but isn't a wrong note.
  if (overrunNote(run.over, steps, midi, t)) return 'overrun';
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
  run.over = startOverrun(steps, run.last, run.startMs);
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
