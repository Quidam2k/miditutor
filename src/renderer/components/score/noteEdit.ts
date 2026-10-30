// #10237: the wheel over a note steps its finger. Empty counts up from 1 or down from 5;
// past either end it's empty again, which is how a mark comes off.
export type FingerDigit = '1' | '2' | '3' | '4' | '5';

export function nextFinger(current: string | null | undefined, up: boolean): FingerDigit | null {
  const n = Number(current);
  if (!current || !Number.isInteger(n) || n < 1 || n > 5) return up ? '1' : '5';
  const next = up ? n + 1 : n - 1;
  return next < 1 || next > 5 ? null : (String(next) as FingerDigit);
}

/**
 * #10256: put a chord's finger marks low to high, leaving anything else in its slot. OSMD stacks
 * labels by the order they came in the file, then flips them under the left hand, assuming low
 * first; a chord written high first (D3=2 over B2=4) read upside down as 4, 2. Sorted, the labels
 * under a chord read top to bottom as the notes do. Only the drawing order: no mark moves note.
 */
export function fingersLowToHigh<T>(marks: T[], isFinger: (m: T) => boolean, pitch: (m: T) => number | undefined): void {
  const slots = marks.flatMap((m, i) => (isFinger(m) ? [i] : []));
  const sorted = slots.map((i) => marks[i]).sort((a, b) => (pitch(a) ?? 0) - (pitch(b) ?? 0));
  slots.forEach((slot, i) => {
    marks[slot] = sorted[i];
  });
}

/** First step of the bar `delta` bars from `measure`; null when there is no such bar. */
export function stepOfBar(steps: readonly { measure: number }[], measure: number, delta: number): number | null {
  const hit = steps.findIndex((s) => s.measure === measure + delta);
  return hit >= 0 ? hit : null;
}

/** A typed bar number, or null when it isn't one. */
export function parseBar(text: string): number | null {
  const t = text.trim();
  return /^[1-9]\d{0,3}$/.test(t) ? Number(t) : null;
}

/**
 * #10245: where Prev goes. The nearest earlier step with something to play: a tie-only
 * step behind him would seek forward again, straight back to where he was. Null at the start.
 */
export function prevPlayable(steps: readonly { notes: readonly number[] }[], from: number): number | null {
  for (let i = Math.min(from, steps.length) - 1; i >= 0; i--) {
    if (steps[i].notes.length > 0) return i;
  }
  return null;
}

export interface WheelRun {
  at: number;
  delta: number;
  dir: number;
}

/**
 * #10259: which way this wheel event moves, if at all. A pause or a change of direction starts a
 * new gesture, which moves at once however small the delta, so one mouse notch is one step. Within
 * a gesture it takes 100 more: a fast spin steps per notch, a trackpad's stream doesn't race.
 */
export function wheelNotch(run: WheelRun, delta: number, now: number): -1 | 0 | 1 {
  const dir = Math.sign(delta);
  const gap = now - run.at;
  run.at = now;
  if (dir === 0) return 0;
  if (gap > 50 || dir !== run.dir) {
    run.dir = dir;
    run.delta = 0;
    return dir as -1 | 1;
  }
  run.delta += Math.abs(delta);
  if (run.delta < 100) return 0;
  run.delta = 0;
  return dir as -1 | 1;
}

/** #10259: the next note to play that way, inside the loop if there is one. Null: stay put. */
export function stepForWheel(
  steps: readonly { notes: readonly number[] }[],
  from: number,
  dir: -1 | 1,
  range: { first: number; last: number } | null,
): number | null {
  // Already outside it (Shift+wheel went past) the loop doesn't hold him there.
  const within = range && from >= range.first && from <= range.last ? range : null;
  const first = within ? within.first : 0;
  const last = within ? within.last : steps.length - 1;
  for (let i = Math.min(from, steps.length) + dir; i >= first && i <= last; i += dir) {
    if (steps[i].notes.length > 0) return i;
  }
  return null;
}
