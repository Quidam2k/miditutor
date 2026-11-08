import { describe, expect, it } from 'vitest';
import { EYES_UP_MAX_MS, EYES_UP_MIN_MS, EYES_UP_START_MS, nextWindow } from '../src/renderer/engine/EyesUp';

describe('eyes-up window', () => {
  it('shrinks 10% after a right answer within twice the window', () => {
    expect(nextWindow(3000, true, 2500)).toBe(2700);
    expect(nextWindow(3000, true, 6000)).toBe(2700);
  });

  it('stays put after a right but slow answer, or an untimed one', () => {
    expect(nextWindow(3000, true, 6001)).toBe(3000);
    expect(nextWindow(3000, true, null)).toBe(3000);
  });

  it('grows 25% after a miss, timed or not', () => {
    expect(nextWindow(2000, false, 900)).toBe(2500);
    expect(nextWindow(2000, false, null)).toBe(2500);
  });

  it('never goes under the floor or over the ceiling', () => {
    let w = EYES_UP_START_MS;
    for (let i = 0; i < 40; i++) w = nextWindow(w, true, 100);
    expect(w).toBe(EYES_UP_MIN_MS);
    for (let i = 0; i < 40; i++) w = nextWindow(w, false, 100);
    expect(w).toBe(EYES_UP_MAX_MS);
  });

  it('takes about 10 fast right answers to go from 3 s to under 1.1 s', () => {
    let w = EYES_UP_START_MS;
    let n = 0;
    while (w > 1100) {
      w = nextWindow(w, true, 500);
      n++;
    }
    expect(n).toBeGreaterThanOrEqual(9);
    expect(n).toBeLessThanOrEqual(11);
  });

  it('starts from 3 s if the saved window is junk', () => {
    expect(nextWindow(NaN, true, null)).toBe(EYES_UP_START_MS);
  });
});
