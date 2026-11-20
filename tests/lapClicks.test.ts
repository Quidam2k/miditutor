import { describe, it, expect } from 'vitest';
import { countInBeats, countInClicks, lapClicks, oddMeter } from '../src/renderer/engine/KeepGoing';
import type { ScoreStep } from '../src/renderer/engine/ScoreFollower';

// One step per bar start unless more beats are given; bars are laid end to end from `start`.
function bars(sig: string, beats: number, count: number, opts: { pickup?: number; extraAt?: number[] } = {}): ScoreStep[] {
  const steps: ScoreStep[] = [];
  let start = 0;
  const lens = [...(opts.pickup ? [opts.pickup] : []), ...Array(count).fill(beats)];
  lens.forEach((len, i) => {
    const bar = { start, beats, len, sig };
    steps.push({ notes: [60], beat: start, measure: i + 1, bar });
    for (const e of opts.extraAt ?? []) if (e > 0 && e < len) steps.push({ notes: [62], beat: start + e, measure: i + 1, bar });
    start += len;
  });
  steps.push({ notes: [], beat: start, measure: lens.length + 1 }); // sentinel after the last bar (lapBeats looks past `last`)
  return steps;
}
const lastBar = (steps: ScoreStep[]) => steps.length - 2;
const grid = (steps: ScoreStep[]) => lapClicks(steps, 0, lastBar(steps)).map((c) => `${c.rel}${c.down ? '!' : ''}`).join(' ');

describe('lapClicks', () => {
  it('4/4: accent every 4th quarter', () => {
    expect(grid(bars('4/4', 4, 2))).toBe('0! 1 2 3 4! 5 6 7');
  });
  it('3/4: accent every 3rd quarter, 3-beat count-in', () => {
    const s = bars('3/4', 3, 2);
    expect(grid(s)).toBe('0! 1 2 3! 4 5');
    expect(countInBeats(s, 0)).toBe(3);
    expect(countInClicks(s, 0).map((c) => `${c.rel}${c.down ? '!' : ''}`).join(' ')).toBe('-3! -2 -1');
  });
  it('6/8 (3 quarters): three quarter pulses a bar, accent on the first', () => {
    expect(grid(bars('6/8', 3, 2))).toBe('0! 1 2 3! 4 5');
  });
  it('3/8 (1.5 quarters): pulses at 0 and 1, then quiet on the trailing half beat until the next accent', () => {
    // bar 2 starts at 1.5, so its accent is at 1.5 and its second pulse at 2.5
    expect(grid(bars('3/8', 1.5, 2))).toBe('0! 1 1.5! 2.5');
    expect(countInBeats(bars('3/8', 1.5, 2), 0)).toBe(2);
  });
  it('5/8 (2.5 quarters): pulses at 0, 1, 2, quiet on the trailing half beat', () => {
    expect(grid(bars('5/8', 2.5, 2))).toBe('0! 1 2 2.5! 3.5 4.5');
    expect(countInBeats(bars('5/8', 2.5, 2), 0)).toBe(3);
  });
  it('a pickup bar counts its pulses back from its end, no accent; the downbeat after it is accented', () => {
    // 1-beat pickup, then two 4/4 bars: pulse at 0 (the pickup), accent at 1, 5
    expect(grid(bars('4/4', 4, 2, { pickup: 1 }))).toBe('0 1! 2 3 4 5! 6 7 8');
  });
  it('a 2-beat pickup in 4/4 pulses at its two quarters', () => {
    expect(grid(bars('4/4', 4, 1, { pickup: 2 }))).toBe('0 1 2! 3 4 5');
  });
  it('a meter change mid-piece: each bar follows its own signature', () => {
    const a = bars('4/4', 4, 1);
    a.pop();
    const b = bars('3/4', 3, 1).map((x) => ({ ...x, beat: x.beat + 4, ...(x.bar ? { bar: { ...x.bar, start: x.bar.start + 4 } } : {}) }));
    expect(grid([...a, ...b])).toBe('0! 1 2 3 4! 5 6');
  });
  it('a loop that starts mid-piece keeps the bar grid', () => {
    const s = bars('4/4', 4, 3);
    expect(lapClicks(s, 1, 2).map((c) => `${c.rel}${c.down ? '!' : ''}`).join(' ')).toBe('0! 1 2 3 4! 5 6 7');
  });
  it('a loop that starts on the third beat of a bar: first accent where the next bar starts', () => {
    const s = bars('4/4', 4, 2, { extraAt: [2] });
    // steps: bar1@0, bar1@2, bar2@4, bar2@6, sentinel; loop steps 1..3 (from beat 2 to 8)
    expect(lapClicks(s, 1, 3).map((c) => `${c.rel}${c.down ? '!' : ''}`).join(' ')).toBe('0 1 2! 3 4 5');
  });
  it('no bar data: the old first-bar rule', () => {
    const s: ScoreStep[] = [{ notes: [60], beat: 0, measure: 1 }, { notes: [60], beat: 2, measure: 1 }, { notes: [60], beat: 4, measure: 2 }, { notes: [60], beat: 6, measure: 2 }, { notes: [], beat: 8, measure: 3 }];
    expect(lapClicks(s, 0, 3).map((c) => `${c.rel}${c.down ? '!' : ''}`).join(' ')).toBe('0! 1 2 3 4! 5 6 7');
  });
});

describe('oddMeter', () => {
  it('null for 4/4, the signature for anything else', () => {
    expect(oddMeter(bars('4/4', 4, 2), 0, 1)).toBeNull();
    expect(oddMeter(bars('6/8', 3, 2), 0, 1)).toBe('6/8');
    expect(oddMeter(bars('3/4', 3, 2), 0, 1)).toBe('3/4');
  });
});
