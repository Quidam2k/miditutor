import { clusterWindows, type Span } from './TroubleSpots';

// #6530 F (Todd msg 64411): a guided lesson plan for a loop he has played through a few times.
// From its last laps' misses: 3-5 bar sub-loops in bar order, each looped until clean enough
// times, then the whole loop once clean, then "Lesson plan complete". A lap with a wrong note
// just doesn't count (never a scold, never a score).

export interface LessonStep extends Span {
  need: number; // clean laps it takes
  whole?: true; // the closing run of his whole loop
}

export interface LessonState {
  main: Span; // his own loop (Stop and the end go back to it)
  steps: LessonStep[];
  at: number; // index into steps
  clean: number; // clean laps on steps[at]
  done: boolean;
}

/** Laps of the loop before the button turns on ("no matter how well I do"). */
export const LESSON_MIN_LAPS = 5;
/** Laps the plan is built from (the most recent). */
export const LESSON_LAPS = 6;
/** Sub-loops at most. */
export const LESSON_MAX_STEPS = 4;

/** The plan from his laps of `loop` (each lap = the bars he missed in it), or null if none missed. */
export function buildPlan(laps: number[][], loop: Span): LessonState | null {
  const recent = laps.slice(-LESSON_LAPS).map((lap) => new Set(lap.filter((b) => b >= loop.first && b <= loop.last)));
  const weight = new Map<number, number>();
  for (const lap of recent) for (const bar of lap) weight.set(bar, (weight.get(bar) ?? 0) + 1);
  if (weight.size === 0) return null;

  const windows = clusterWindows([...weight].map(([bar, w]) => ({ bar, weight: w })), loop)
    .slice(0, LESSON_MAX_STEPS)
    .filter((w) => !(w.first === loop.first && w.last === loop.last))
    .sort((a, b) => a.first - b.first);
  const steps: LessonStep[] = windows.map((w) => {
    // Laps with a miss anywhere in this window: in 60% or more of them, 3 clean laps; else 2.
    const missed = recent.filter((lap) => [...lap].some((b) => b >= w.first && b <= w.last)).length;
    return { first: w.first, last: w.last, need: missed * 10 >= recent.length * 6 ? 3 : 2 };
  });
  steps.push({ first: loop.first, last: loop.last, need: 1, whole: true });
  return { main: { first: loop.first, last: loop.last }, steps, at: 0, clean: 0, done: false };
}

/** One lap of the current step finished. `advanced` = on to the next step; `done` = the plan is complete. */
export function lessonLapDone(s: LessonState, wrong: number): { state: LessonState; advanced: boolean; done: boolean } {
  if (s.done || wrong > 0) return { state: s, advanced: false, done: false };
  const clean = s.clean + 1;
  if (clean < s.steps[s.at].need) return { state: { ...s, clean }, advanced: false, done: false };
  if (s.at >= s.steps.length - 1) return { state: { ...s, clean, done: true }, advanced: false, done: true };
  return { state: { ...s, at: s.at + 1, clean: 0 }, advanced: true, done: false };
}

/** Skip the current step (the last step skipped ends the plan). */
export function skipStep(s: LessonState): { state: LessonState; done: boolean } {
  if (s.at >= s.steps.length - 1) return { state: { ...s, done: true }, done: true };
  return { state: { ...s, at: s.at + 1, clean: 0 }, done: false };
}

const barsText = (s: Span) => (s.first === s.last ? `bar ${s.first}` : `bars ${s.first}–${s.last}`);

/** "Lesson plan: step 2 of 4 · bars 9–13 · 1 of 3 clean" */
export function lessonLabel(s: LessonState): string {
  const step = s.steps[s.at];
  const what = step.whole ? `the whole loop, ${barsText(step)}` : barsText(step);
  return `Lesson plan: step ${s.at + 1} of ${s.steps.length} · ${what} · ${s.clean} of ${step.need} clean`;
}

/** The 3 s tip when it moves on. */
export function nextLabel(s: LessonState): string {
  const step = s.steps[s.at];
  return step.whole ? `Next: the whole loop, ${barsText(step)}` : `Next: ${barsText(step)}`;
}
