/**
 * #5652 B Eyes up (Todd's note on JP's 11/6 entry: "each note disappears after a few seconds,
 * sooner as reading gets faster"). Read the note, then look down and find it: the note hides
 * so he can't glance back. Gentle on purpose (evidence check 11/8: time pressure is thin help
 * and adds stress): a hidden note is never a miss, he answers whenever he's ready, and the
 * window shrinks only a little at a time.
 *
 * 'timer': the note hides after the window. 'pedal': no timer; it hides when he presses the
 * sustain pedal, i.e. when he says he has read it.
 */
export type EyesUpMode = 'off' | 'timer' | 'pedal';

export const EYES_UP_START_MS = 3000;
export const EYES_UP_MIN_MS = 1000;
export const EYES_UP_MAX_MS = 5000;
/** A right answer this fast (from the note showing) is a fast one. */
export const EYES_UP_FAST_FACTOR = 2;

/**
 * The next window. Right and fast (within twice the window): 10% shorter. Wrong: 25% longer.
 * Right but slow: unchanged. Untimed answers (the first note, names on) leave it alone.
 */
export function nextWindow(windowMs: number, correct: boolean, answerMs: number | null): number {
  const w = Number.isFinite(windowMs) ? windowMs : EYES_UP_START_MS;
  let next = w;
  if (!correct) next = w * 1.25;
  else if (answerMs !== null && answerMs <= w * EYES_UP_FAST_FACTOR) next = w * 0.9;
  return Math.round(Math.min(EYES_UP_MAX_MS, Math.max(EYES_UP_MIN_MS, next)) / 50) * 50;
}
