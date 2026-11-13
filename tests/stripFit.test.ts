import { describe, expect, it } from 'vitest';
import { STRIP_FILL, STRIP_MAX_ZOOM, STRIP_MIN_ZOOM, centreShift, fitZoom } from '../src/renderer/engine/stripFit';

describe('fitZoom (#6055)', () => {
  it('grows until the ink fills the share of the free height', () => {
    const z = fitZoom(225, 578, 1);
    expect(z).toBeCloseTo((578 * STRIP_FILL) / 225, 5);
    expect(z).toBeGreaterThan(2);
  });
  it('is stable: measured again at the new zoom it stays put', () => {
    const z = fitZoom(225, 578, 1);
    expect(fitZoom(225 * z, 578, z)).toBe(z);
  });
  it('shrinks back (to no less than the floor) when the free height shrinks', () => {
    expect(fitZoom(600, 300, 2)).toBeCloseTo((2 * 300 * STRIP_FILL) / 600, 5);
    expect(fitZoom(600, 100, 1)).toBe(STRIP_MIN_ZOOM);
    expect(fitZoom(400, 360, 2)).toBeCloseTo((2 * 360 * STRIP_FILL) / 400, 5);
  });
  it('is capped', () => {
    expect(fitZoom(10, 1000, 1)).toBe(STRIP_MAX_ZOOM);
  });
  it('ignores a hidden or unmeasured panel', () => {
    expect(fitZoom(0, 500, 1.4)).toBe(1.4);
    expect(fitZoom(200, 0, 1.4)).toBe(1.4);
  });
  it('leaves small drift alone', () => {
    expect(fitZoom(300, 322, 1)).toBe(1);
  });
});

describe('centreShift', () => {
  it('moves the ink centre to the area centre', () => {
    expect(centreShift(100, 200, 0, 400)).toBe(50);
    expect(centreShift(150, 250, 0, 400)).toBe(0);
    expect(centreShift(300, 380, 0, 400)).toBe(-140);
  });
});
