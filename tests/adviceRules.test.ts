import { describe, it, expect } from 'vitest';
import {
  loopReshape,
  pauseBefore,
  worseThanBest,
  velocityOutlier,
  spotBack,
  type Run,
  type VelSample,
} from '../src/renderer/engine/AdviceRules';
import type { Spot } from '../src/renderer/engine/TroubleSpots';

describe('loopReshape', () => {
  const loop = { first: 1, last: 20 };

  it('finds clean stretches and trouble windows', () => {
    const laps = [[10, 17, 18], [10, 17, 18], [10, 17]];
    const result = loopReshape(laps, loop);
    expect(result).not.toBeNull();
    if (result === null) return;
    // Bar 10 is a miss, so the maximal clean run from the start is 1..9.
    expect(result.clean).toContainEqual({ first: 1, last: 9 });
    expect(result.clean).toContainEqual({ first: 11, last: 16 });
    expect(result.clean).toContainEqual({ first: 19, last: 20 });
    expect(result.windows.length).toBeGreaterThanOrEqual(1);
    for (const w of result.windows) {
      expect(w.first).toBeGreaterThanOrEqual(loop.first);
      expect(w.last).toBeLessThanOrEqual(loop.last);
    }
    expect(result.windows.some((w) => w.first <= 10 && w.last >= 10)).toBe(true);
    expect(
      result.windows.some((w) => w.first <= 17 && w.last >= 18),
    ).toBe(true);
  });

  it('returns null with fewer than 3 laps', () => {
    expect(loopReshape([[10], [10]], loop)).toBeNull();
  });

  it('returns null when the loop is shorter than 8 bars', () => {
    const laps = [[3], [3], [3]];
    expect(loopReshape(laps, { first: 1, last: 7 })).toBeNull();
  });

  it('returns null when there are no misses', () => {
    expect(loopReshape([[], [], []], loop)).toBeNull();
  });

  it('ignores misses outside the loop', () => {
    expect(loopReshape([[30], [30], [30]], loop)).toBeNull();
  });

  it('returns null when clean runs are too short', () => {
    const laps = [[1, 3, 5, 7, 9], [1, 3, 5, 7, 9], [1, 3, 5, 7, 9]];
    expect(loopReshape(laps, { first: 1, last: 10 })).toBeNull();
  });
});

describe('pauseBefore', () => {
  it('finds a bar with 3 trailing hesitations', () => {
    const entries = new Map<number, boolean[]>([[5, [false, true, true, true]]]);
    expect(pauseBefore(entries)).toEqual({ bar: 5, times: 3 });
  });

  it('returns null with fewer than 3 entries', () => {
    const entries = new Map<number, boolean[]>([[5, [true, true]]]);
    expect(pauseBefore(entries)).toBeNull();
  });

  it('returns null when the last 3 are not all true', () => {
    const entries = new Map<number, boolean[]>([
      [5, [true, true, false, true, true]],
      [6, [true, true, true, false]],
    ]);
    expect(pauseBefore(entries)).toBeNull();
  });

  it('counts the full trailing run', () => {
    const entries = new Map<number, boolean[]>([
      [5, [false, true, true, true, true]],
    ]);
    expect(pauseBefore(entries)).toEqual({ bar: 5, times: 4 });
  });

  it('prefers the largest run', () => {
    const entries = new Map<number, boolean[]>([
      [2, [true, true, true]],
      [9, [true, true, true, true]],
    ]);
    expect(pauseBefore(entries)).toEqual({ bar: 9, times: 4 });
  });

  it('breaks ties by lower bar', () => {
    const entries = new Map<number, boolean[]>([
      [9, [true, true, true]],
      [4, [true, true, true]],
    ]);
    expect(pauseBefore(entries)).toEqual({ bar: 4, times: 3 });
  });
});

describe('worseThanBest', () => {
  const run = (over: Partial<Run>): Run => ({
    first: 1,
    last: 30,
    wrong: 0,
    wrongBars: [],
    at: 0,
    ...over,
  });

  it('reports a clearly worse run with windows on the new trouble bars', () => {
    const current = run({ wrong: 6, wrongBars: [3, 3, 4, 5, 5, 5], at: 5 });
    const others = [
      run({ wrong: 2, wrongBars: [4, 5], at: 1 }),
      run({ wrong: 4, wrongBars: [4, 5, 9], at: 2 }),
    ];
    const result = worseThanBest(current, others);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.best).toBe(2);
    expect(result.now).toBe(6);
    expect(result.windows.length).toBeGreaterThanOrEqual(1);
    expect(result.windows.length).toBeLessThanOrEqual(2);
    for (const w of result.windows) {
      expect(w.first).toBeGreaterThanOrEqual(1);
      expect(w.last).toBeLessThanOrEqual(30);
    }
    expect(result.windows.some((w) => w.first <= 3 && w.last >= 3)).toBe(true);
  });

  it('needs at least 2 comparable others', () => {
    const current = run({ wrong: 8, wrongBars: [3], at: 5 });
    expect(
      worseThanBest(current, [run({ wrong: 1, wrongBars: [], at: 1 })]),
    ).toBeNull();
  });

  it('ignores others with a different range or the same timestamp', () => {
    const current = run({ wrong: 8, wrongBars: [3], at: 5 });
    const others = [
      run({ wrong: 1, at: 1 }),
      run({ wrong: 1, at: 2, last: 29 }),
      run({ wrong: 1, at: 5 }),
    ];
    expect(worseThanBest(current, others)).toBeNull();
  });

  it('returns null when only 2 worse than best', () => {
    const current = run({ wrong: 4, wrongBars: [3, 3, 3, 3], at: 5 });
    const others = [
      run({ wrong: 2, at: 1 }),
      run({ wrong: 3, at: 2 }),
    ];
    expect(worseThanBest(current, others)).toBeNull();
  });

  it('fires at exactly 3 worse than best', () => {
    const current = run({ wrong: 5, wrongBars: [3, 3, 3, 3, 3], at: 5 });
    const others = [run({ wrong: 2, at: 1 }), run({ wrong: 3, at: 2 })];
    expect(worseThanBest(current, others)).not.toBeNull();
  });

  it('returns null when all wrong bars were also wrong in the best run', () => {
    const current = run({ wrong: 6, wrongBars: [3, 4], at: 5 });
    const others = [
      run({ wrong: 2, wrongBars: [3, 4], at: 1 }),
      run({ wrong: 3, wrongBars: [3], at: 2 }),
    ];
    expect(worseThanBest(current, others)).toBeNull();
  });

  it('breaks best-run ties by latest at', () => {
    const current = run({ wrong: 5, wrongBars: [3, 25], at: 9 });
    const others = [
      run({ wrong: 2, wrongBars: [3], at: 1 }),
      run({ wrong: 2, wrongBars: [25], at: 2 }),
    ];
    const result = worseThanBest(current, others);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.best).toBe(2);
    // Best is the later run (wrong bar 25), so only bar 3 is new trouble.
    expect(result.windows).toHaveLength(1);
    const w = result.windows[0];
    expect(w).toBeDefined();
    if (w === undefined) return;
    expect(w.first).toBeLessThanOrEqual(3);
    expect(w.last).toBeGreaterThanOrEqual(3);
    expect(w.last).toBeLessThan(25);
  });
});

describe('velocityOutlier', () => {
  function group(
    lap: number,
    hand: 'L' | 'R',
    base: number,
    quietStep: number,
    quietVel: number,
    vel = 60,
  ): VelSample[] {
    const out: VelSample[] = [];
    for (let step = base; step < base + 5; step++) {
      out.push({
        step,
        note: 40 + step,
        hand,
        velocity: step === quietStep ? quietVel : vel,
        lap,
      });
    }
    return out;
  }

  it('finds a consistently quiet key', () => {
    const samples = [1, 2, 3].flatMap((lap) => group(lap, 'R', 1, 3, 30));
    expect(velocityOutlier(samples)).toEqual({
      step: 3,
      note: 43,
      hand: 'R',
      ratio: 0.5,
      laps: 3,
    });
  });

  it('rounds the median ratio to 0.01', () => {
    const samples = [1, 2, 3].flatMap((lap) => group(lap, 'R', 1, 3, 47));
    const result = velocityOutlier(samples);
    expect(result).not.toBeNull();
    expect(result?.ratio).toBe(0.78);
  });

  it('returns null with fewer than 3 judged laps', () => {
    const samples = [1, 2].flatMap((lap) => group(lap, 'R', 1, 3, 30));
    expect(velocityOutlier(samples)).toBeNull();
  });

  it('returns null when quiet in under 75% of laps', () => {
    const samples = [
      ...group(1, 'R', 1, 3, 30),
      ...group(2, 'R', 1, 3, 30),
      ...group(3, 'R', 1, 3, 60),
    ];
    expect(velocityOutlier(samples)).toBeNull();
  });

  it('accepts exactly 75% quiet laps', () => {
    const samples = [
      ...group(1, 'R', 1, 3, 30),
      ...group(2, 'R', 1, 3, 30),
      ...group(3, 'R', 1, 3, 30),
      ...group(4, 'R', 1, 3, 60),
    ];
    const result = velocityOutlier(samples);
    expect(result?.step).toBe(3);
    expect(result?.laps).toBe(4);
  });

  it('does not count a velocity just at the 0.8 threshold as quiet', () => {
    const samples = [1, 2, 3].flatMap((lap) => group(lap, 'R', 1, 3, 48));
    expect(velocityOutlier(samples)).toBeNull();
  });

  it('needs at least 2 neighbours', () => {
    const samples: VelSample[] = [];
    for (let lap = 1; lap <= 3; lap++) {
      samples.push({ step: 1, note: 41, hand: 'R', velocity: 60, lap });
      samples.push({ step: 2, note: 42, hand: 'R', velocity: 20, lap });
    }
    expect(velocityOutlier(samples)).toBeNull();
  });

  it('needs a neighbour mean of at least 30', () => {
    const samples = [1, 2, 3].flatMap((lap) => group(lap, 'R', 1, 3, 5, 25));
    expect(velocityOutlier(samples)).toBeNull();
  });

  it('ignores neighbours from the other hand', () => {
    const samples: VelSample[] = [];
    for (let lap = 1; lap <= 3; lap++) {
      samples.push({ step: 3, note: 43, hand: 'R', velocity: 20, lap });
      samples.push({ step: 2, note: 42, hand: 'L', velocity: 60, lap });
      samples.push({ step: 4, note: 44, hand: 'L', velocity: 60, lap });
    }
    expect(velocityOutlier(samples)).toBeNull();
  });

  it('keeps only the last sample per key per lap', () => {
    const samples: VelSample[] = [];
    for (let lap = 1; lap <= 3; lap++) {
      samples.push({ step: 3, note: 43, hand: 'R', velocity: 30, lap });
      samples.push(...group(lap, 'R', 1, 3, 60));
    }
    expect(velocityOutlier(samples)).toBeNull();
  });

  it('picks the lowest ratio, then the lower step', () => {
    const tied = [1, 2, 3].flatMap((lap) => [
      ...group(lap, 'L', 11, 13, 30),
      ...group(lap, 'R', 1, 3, 30),
    ]);
    expect(velocityOutlier(tied)?.step).toBe(3);

    const lower = [1, 2, 3].flatMap((lap) => [
      ...group(lap, 'R', 1, 3, 40),
      ...group(lap, 'L', 21, 23, 20),
    ]);
    const result = velocityOutlier(lower);
    expect(result?.step).toBe(23);
    expect(result?.hand).toBe('L');
  });
});

describe('spotBack', () => {
  const spot = (over: Partial<Spot>): Spot => ({
    first: 5,
    last: 8,
    alone: 0.5,
    inContext: 0.5,
    added: '2025-01-01',
    ticked: '2025-01-10',
    ...over,
  });

  it('flags a ticked spot with enough misses since', () => {
    const s = spot({});
    const misses = new Map<number, number>([[5, 1], [6, 2], [20, 9]]);
    expect(spotBack([s], misses, '2025-01-15')).toEqual({
      spot: s,
      misses: 3,
      daysAgo: 5,
    });
  });

  it('returns null below 3 misses', () => {
    const misses = new Map<number, number>([[5, 1], [6, 1]]);
    expect(spotBack([spot({})], misses, '2025-01-15')).toBeNull();
  });

  it('ignores spots without ticked or ticked today or later', () => {
    const misses = new Map<number, number>([[5, 5]]);
    const spots = [
      spot({ ticked: undefined }),
      spot({ ticked: '2025-01-15' }),
      spot({ ticked: '2025-01-16' }),
    ];
    expect(spotBack(spots, misses, '2025-01-15')).toBeNull();
  });

  it('counts days across a month boundary', () => {
    const misses = new Map<number, number>([[5, 3]]);
    const result = spotBack([spot({ ticked: '2025-02-28' })], misses, '2025-03-02');
    expect(result?.daysAgo).toBe(2);
  });

  it('picks the spot with the most misses', () => {
    const a = spot({ first: 1, last: 2 });
    const b = spot({ first: 10, last: 11 });
    const misses = new Map<number, number>([[1, 3], [10, 4]]);
    expect(spotBack([a, b], misses, '2025-01-15')?.spot).toBe(b);
  });

  it('breaks ties by lower first bar', () => {
    const a = spot({ first: 10, last: 11 });
    const b = spot({ first: 1, last: 2 });
    const misses = new Map<number, number>([[1, 3], [10, 3]]);
    expect(spotBack([a, b], misses, '2025-01-15')?.spot).toBe(b);
  });
});
