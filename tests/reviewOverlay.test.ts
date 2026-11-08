import { describe, expect, it } from 'vitest';
import type { LayoutSystem } from '../src/shared/review';
import { DigitalBar, alignBar, pageLineBar, stepBar } from '../src/shared/reviewOverlay';

const sys = (over: Partial<LayoutSystem> = {}): LayoutSystem => ({
  index: 1, page: '01.png', y0: 677, y1: 1187, spacing: 21,
  staves: [[761, 783, 805, 825, 847], [1016, 1037, 1059, 1081, 1103]],
  x_left: 378, x_right: 2308, barlines: [378, 1070, 1483, 1905, 2308], bars: 4,
  measures: [1, 4], numbers: ['1', '4'], crop: 'x.jpg', ...over,
});
// OSMD frame: 40 px staves 100 px apart (scan: 43 px staves, 84.5 px apart).
const digital = (over: Partial<DigitalBar> = {}): DigitalBar =>
  ({ measure: 1, x: 50, w: 200, staves: [{ y0: 30, y1: 70 }, { y0: 170, y1: 210 }], ...over });
const map = (f: { sx: number; sy: number; tx: number; ty: number }, x: number, y: number) =>
  [x * f.sx + f.tx, y * f.sy + f.ty];

describe('alignBar', () => {
  it('scales by bar width and staff height, and lines up the left barline and top staff line', () => {
    const fit = alignBar(sys(), 0.5, 255, 1, digital());
    if (!fit.ok) throw new Error(fit.reason);
    const [top, bottom] = fit.fits;
    expect(top.sx).toBeCloseTo(346 / 200);
    expect(top.sy).toBeCloseTo(43 / 40);
    const [x, y] = map(top, 50, 30);
    expect(x).toBeCloseTo(189);
    expect(y).toBeCloseTo(42);
    expect(map(top, 250, 70)[0]).toBeCloseTo(535); // right barline
    // Each staff lands on its own lines, though the gaps differ.
    expect(map(bottom, 50, 170)[1]).toBeCloseTo((1016 - 677) / 2);
    expect(map(bottom, 50, 210)[1]).toBeCloseTo((1103 - 677) / 2);
  });

  it('clips each staff at the midpoint between staves, and to its own bar', () => {
    const fit = alignBar(sys(), 0.5, 255, 2, digital({ measure: 2 }));
    if (!fit.ok) throw new Error(fit.reason);
    const mid = ((847 - 677) / 2 + (1016 - 677) / 2) / 2;
    expect(fit.fits[0].clip).toEqual({ x: 535, y: 0, w: 206.5, h: mid });
    expect(fit.fits[1].clip.y).toBeCloseTo(mid);
    expect(fit.fits[1].clip.y + fit.fits[1].clip.h).toBeCloseTo(255);
  });

  it("stops at the score's own midpoint when its staves sit closer than the scan's", () => {
    const fit = alignBar(sys(), 0.5, 255, 1, digital({ staves: [{ y0: 30, y1: 70 }, { y0: 80, y1: 120 }] }));
    if (!fit.ok) throw new Error(fit.reason);
    const [top, bottom] = fit.fits;
    expect(top.clip.y + top.clip.h).toBeCloseTo(75 * top.sy + top.ty); // the score's lower staff stays out
    expect(bottom.clip.y).toBeCloseTo(75 * bottom.sy + bottom.ty);
  });

  it('says in plain words why a bar cannot be laid over', () => {
    const why = (s: LayoutSystem, m: number, d: DigitalBar | undefined) => {
      const f = alignBar(s, 0.5, 255, m, d);
      return f.ok ? 'ok' : f.reason;
    };
    expect(why(sys({ measures: null }), 1, digital())).toMatch(/isn't matched/);
    expect(why(sys(), 5, digital())).toMatch(/bar lines don't match/);
    expect(why(sys({ barlines: [378, 1070, 2308] }), 1, digital())).toMatch(/bar lines don't match/);
    expect(why(sys(), 1, undefined)).toMatch(/didn't draw/);
    expect(why(sys(), 1, digital({ w: 0 }))).toMatch(/didn't draw/);
    expect(why(sys(), 1, digital({ staves: [{ y0: 30, y1: 70 }] }))).toMatch(/different number of staves/);
    expect(why(sys({ staves: [[761], [1016, 1103]] }), 1, digital())).toMatch(/lines are missing/);
    expect(why(sys(), 1, digital({ w: 2000 }))).toMatch(/too differently shaped/);
  });
});

describe('pageLineBar', () => {
  const systems = [
    sys(), sys({ index: 2, measures: [5, 10], bars: 6 }),
    sys({ index: 5, page: '02.png', measures: [23, 27], bars: 5 }),
    sys({ index: 6, page: '02.png', measures: [28, 32], bars: 5 }),
  ];
  it('counts pages, the line on its page and the bar in its line', () => {
    expect(pageLineBar({ systems }, 6, 31)).toMatchObject({ page: 2, line: 2, bar: 4, label: 'Page 2, line 2, 4th bar' });
    expect(pageLineBar({ systems, pages: [{ file: '00.png' }, { file: '01.png' }, { file: '02.png' }] }, 1, 3))
      .toMatchObject({ page: 2, line: 1, label: 'Page 2, line 1, 3rd bar' });
  });
  it('is null off the line', () => {
    expect(pageLineBar({ systems }, 6, 33)).toBeNull();
    expect(pageLineBar({ systems }, 9, 1)).toBeNull();
    expect(pageLineBar({ systems: [sys({ measures: null })] }, 1, 1)).toBeNull();
  });
  it('writes ordinals', () => {
    const long = [sys({ measures: [1, 30], bars: 30 })];
    const word = (b: number) => pageLineBar({ systems: long }, 1, b)?.label.split(', ')[2];
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(word)).toEqual(
      ['1st bar', '2nd bar', '3rd bar', '4th bar', '11th bar', '12th bar', '13th bar', '21st bar', '22nd bar']);
  });
});

describe('stepBar', () => {
  const systems = [sys(), sys({ index: 2, bars: 0 }), sys({ index: 3, measures: [5, 10], bars: 6 })];
  it('moves within a line and wraps across lines, skipping empty ones', () => {
    expect(stepBar(systems, 0, 1, 1)).toEqual({ linePos: 0, barPos: 2 });
    expect(stepBar(systems, 0, 3, 1)).toEqual({ linePos: 2, barPos: 0 });
    expect(stepBar(systems, 2, 0, -1)).toEqual({ linePos: 0, barPos: 3 });
  });
  it('stops at the ends', () => {
    expect(stepBar(systems, 0, 0, -1)).toBeNull();
    expect(stepBar(systems, 2, 5, 1)).toBeNull();
  });
});
