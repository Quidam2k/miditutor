// #10237: the wheel over a note steps its finger. Empty counts up from 1 or down from 5;
// past either end it's empty again, which is how a mark comes off.
export type FingerDigit = '1' | '2' | '3' | '4' | '5';

export function nextFinger(current: string | null | undefined, up: boolean): FingerDigit | null {
  const n = Number(current);
  if (!current || !Number.isInteger(n) || n < 1 || n > 5) return up ? '1' : '5';
  const next = up ? n + 1 : n - 1;
  return next < 1 || next > 5 ? null : (String(next) as FingerDigit);
}

/** First step of the bar `delta` bars from `measure`; null when there is no such bar. */
export function stepOfBar(steps: readonly { measure: number }[], measure: number, delta: number): number | null {
  const hit = steps.findIndex((s) => s.measure === measure + delta);
  return hit >= 0 ? hit : null;
}
