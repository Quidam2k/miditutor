import { describe, it, expect } from 'vitest';
import { hesitationMs, MIN_HESITATION_MS, startBare, bareNote, bareMiss, closeBar, BARE_MS } from '../src/renderer/engine/TrainingWheels';

describe('hesitationMs (#5519)', () => {
  it('no pace yet: the floor', () => expect(hesitationMs([])).toBe(MIN_HESITATION_MS));
  it('twice his median step gap', () => expect(hesitationMs([700, 800, 900])).toBe(1600));
  it('a fast pace still waits the floor', () => expect(hesitationMs([200, 250, 300])).toBe(MIN_HESITATION_MS));
  it('one long pause does not stretch it (median, not mean)', () => expect(hesitationMs([700, 700, 9000])).toBe(1400));
  it('only the last 8 gaps count', () => expect(hesitationMs([5000, 5000, 5000, ...Array(8).fill(800)])).toBe(1600));
});

describe('five minutes without hints (#11354)', () => {
  const play = (bars: (number | 'x')[]) => {
    let r = startBare('p', 1000);
    let bar = 0;
    for (const b of bars) {
      if (b === 'x') r = bareMiss(r, bar);
      else { bar = b; r = bareNote(r, b); }
    }
    return r;
  };
  it('runs five minutes', () => expect(startBare('p', 1000).endsAt).toBe(1000 + BARE_MS));
  it('a bar counts once he leaves it clean', () => expect(play([1, 1, 2, 2, 3]).cleared).toBe(2));
  it('a miss spoils only its bar', () => {
    const r = play([1, 1, 'x', 1, 2, 3]);
    expect(r.cleared).toBe(1);
    expect(r.misses).toBe(1);
  });
  it('a miss on the first note of a new bar spoils the new bar, not the one he finished', () => {
    let r = bareNote(startBare('p', 0), 1);
    r = bareMiss(r, 2);
    r = bareNote(r, 2);
    r = bareNote(r, 3);
    expect(r.cleared).toBe(1);
  });
  it('the last bar of a lap counts when the lap ends', () => expect(closeBar(play([1, 2])).cleared).toBe(2));
  it('closing twice does not count twice', () => expect(closeBar(closeBar(play([1]))).cleared).toBe(1));
});
