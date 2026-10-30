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
