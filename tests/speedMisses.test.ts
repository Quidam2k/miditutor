import { describe, it, expect } from 'vitest';
import {
  missRate,
  slowBars,
  speedVsMisses,
  type Run,
} from '../src/renderer/engine/SpeedMisses';

function run(bpm: number, wrong: number, first = 1, last = 4, at?: number): Run {
  return at === undefined
    ? { bpm, wrong, firstBar: first, lastBar: last }
    : { bpm, wrong, firstBar: first, lastBar: last, at };
}

describe('speedVsMisses', () => {
  it('fires the halves rule on slow-clean vs fast-messy runs', () => {
    const runs = [
      run(68, 0),
      run(70, 0),
      run(72, 0),
      run(88, 2),
      run(90, 3),
      run(92, 2),
    ];
    const a = speedVsMisses(runs);
    expect(a).not.toBeNull();
    expect(a?.rule).toBe('halves');
    expect(a?.above).toBe(88);
    expect(a?.tryBpm).toBe(70);
    expect(a?.slowRate).toBe(0);
    expect(a?.fastRate).toBe(0.58);
    expect(a?.runs).toBe(6);
    expect(a?.first).toBe(1);
    expect(a?.last).toBe(4);
  });

  it('does not fire when the tempo spread is under 4 bpm', () => {
    const runs = [
      run(70, 0),
      run(71, 0),
      run(72, 0),
      run(73, 3),
      run(74, 3),
      run(75, 3),
    ];
    expect(speedVsMisses(runs)).toBeNull();
  });

  it('does not fire with fewer than 6 runs', () => {
    const runs = [run(68, 0), run(70, 0), run(88, 2), run(90, 3), run(92, 2)];
    expect(speedVsMisses(runs)).toBeNull();
  });

  it('uses the given range to choose between two groups', () => {
    const a = [
      run(68, 0, 1, 4),
      run(70, 0, 1, 4),
      run(72, 0, 1, 4),
      run(88, 2, 1, 4),
      run(90, 3, 1, 4),
      run(92, 2, 1, 4),
    ];
    const b = [70, 71, 72, 73, 74, 75, 76, 77].map((bpm) => run(bpm, 0, 5, 8));
    const all = [...a, ...b];
    expect(speedVsMisses(all)).toBeNull(); // biggest group is clean
    const r = speedVsMisses(all, { first: 1, last: 4 });
    expect(r?.rule).toBe('halves');
    expect(r?.first).toBe(1);
    expect(r?.last).toBe(4);
    expect(speedVsMisses(all, { first: 9, last: 9 })).toBeNull();
  });

  it('drops the middle run when the count is odd', () => {
    const runs = [
      run(60, 0, 1, 1),
      run(70, 0, 1, 1),
      run(72, 0, 1, 1),
      run(80, 40, 1, 1), // middle: in neither half
      run(90, 1, 1, 1),
      run(92, 1, 1, 1),
      run(94, 1, 1, 1),
    ];
    const a = speedVsMisses(runs);
    expect(a?.rule).toBe('halves');
    expect(a?.slowRate).toBe(0);
    expect(a?.fastRate).toBe(1);
    expect(a?.above).toBe(90);
    expect(a?.tryBpm).toBe(70);
    expect(a?.runs).toBe(7);
  });

  it('fires overrun on a latest fast messy run against clean runs', () => {
    const runs = [
      run(70, 0, 1, 1, 1),
      run(70, 0, 1, 1, 2),
      run(70, 0, 1, 1, 3),
      run(71, 0, 1, 1, 4),
      run(72, 0, 1, 1, 5),
      run(90, 3, 1, 1, 6),
    ];
    const a = speedVsMisses(runs);
    expect(a?.rule).toBe('overrun');
    expect(a?.above).toBe(77);
    expect(a?.tryBpm).toBe(70);
    expect(a?.fastRate).toBe(3);
    expect(a?.slowRate).toBe(0);
  });

  it('overrun needs at least 2 clean runs', () => {
    const runs = [
      run(70, 0, 1, 1, 1),
      run(70, 1, 1, 1, 2),
      run(70, 1, 1, 1, 3),
      run(71, 1, 1, 1, 4),
      run(72, 1, 1, 1, 5),
      run(90, 3, 1, 1, 6),
    ];
    expect(speedVsMisses(runs)).toBeNull();
  });

  it('returns null when the suggested tempo is under 30', () => {
    const runs = [
      run(20, 0),
      run(22, 0),
      run(24, 0),
      run(40, 2),
      run(42, 2),
      run(44, 2),
    ];
    expect(speedVsMisses(runs)).toBeNull();
  });

  it('ignores invalid runs', () => {
    const runs = [
      run(68, 0),
      run(70, 0),
      run(72, 0),
      run(88, 2),
      run(90, 3),
      run(NaN, 0),
      run(0, 0),
      run(80, -1),
      run(80, 0, 4, 1),
    ];
    // only 5 valid runs remain in group 1-4
    expect(speedVsMisses(runs)).toBeNull();
  });
});

describe('slowBars', () => {
  it('filters by hesitation count and ratio, and orders worst first', () => {
    const bars = [
      { bar: 1, strikes: 10, hesitations: 2 }, // too few
      { bar: 2, strikes: 20, hesitations: 3 }, // ratio 0.15, too low
      { bar: 3, strikes: 8, hesitations: 4 }, // 0.5
      { bar: 4, strikes: 8, hesitations: 4 }, // 0.5, tie -> bar asc
      { bar: 5, strikes: 4, hesitations: 4 }, // 1.0
      { bar: 6, strikes: 10, hesitations: 3 }, // 0.3
    ];
    expect(slowBars(bars)).toEqual([5, 3, 4]);
    expect(slowBars(bars, 2)).toEqual([5, 3]);
    expect(slowBars(bars, 10)).toEqual([5, 3, 4, 6]);
  });
});

describe('missRate', () => {
  it('divides wrong notes by the bars covered', () => {
    expect(missRate(run(80, 6, 5, 8))).toBe(1.5);
  });

  it('is 0 for a run with less than one bar', () => {
    expect(missRate(run(80, 6, 5, 4))).toBe(0);
  });
});
