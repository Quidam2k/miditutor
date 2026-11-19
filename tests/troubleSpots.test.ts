import { describe, expect, it } from 'vitest';
import {
  addSpot, autoSpots, countPass, prune, removeSpot, spotAround, spotLabel, type Spot,
} from '../src/renderer/engine/TroubleSpots';

const WHOLE = { first: 1, last: 40 };
const TODAY = '2026-11-18';
const none = new Set<number>();

function passes(spots: Spot[], lap: { first: number; last: number }, n: number, wrong = none, need = 5) {
  let ticked: Spot[] = [];
  for (let i = 0; i < n; i++) {
    const r = countPass(spots, lap, wrong, need, TODAY);
    spots = r.spots;
    ticked = ticked.concat(r.ticked);
  }
  return { spots, ticked };
}

describe('trouble spots', () => {
  it('a spot is its bar and one each side, inside the piece', () => {
    expect(spotAround(30, WHOLE)).toEqual({ first: 29, last: 31 });
    expect(spotAround(1, WHOLE)).toEqual({ first: 1, last: 2 });
    expect(spotAround(40, WHOLE)).toEqual({ first: 39, last: 40 });
  });

  it('adds once, revives a ticked one, removes', () => {
    const one = addSpot([], { first: 31, last: 29 }, TODAY);
    expect(one).toEqual([{ first: 29, last: 31, alone: 0, inContext: 0, added: TODAY }]);
    expect(addSpot(one, { first: 29, last: 31 }, TODAY)).toBe(one);
    const ticked = [{ ...one[0], alone: 5, inContext: 5, ticked: TODAY }];
    expect(addSpot(ticked, one[0], '2026-11-19', true)).toEqual([{ first: 29, last: 31, alone: 0, inContext: 0, added: '2026-11-19', auto: true }]);
    expect(removeSpot(one, { first: 29, last: 31 })).toEqual([]);
  });

  it('comes off only after 5 clean alone AND 5 clean in context (Todd msg 63713)', () => {
    let spots = addSpot([], { first: 29, last: 31 }, TODAY);
    let r = passes(spots, { first: 29, last: 31 }, 7);
    expect(r.spots[0]).toMatchObject({ alone: 7, inContext: 0 });
    expect(r.ticked).toEqual([]);
    // A miss in bar 25 is outside the spot: the pass still counts in context.
    r = passes(r.spots, { first: 21, last: 42 }, 4, new Set([25]));
    expect(r.spots[0]).toMatchObject({ inContext: 4 });
    expect(r.ticked).toEqual([]);
    // A miss in bar 30 is inside: no count.
    r = passes(r.spots, { first: 21, last: 42 }, 1, new Set([30]));
    expect(r.spots[0].inContext).toBe(4);
    r = passes(r.spots, { first: 25, last: 35 }, 1);
    expect(r.ticked).toHaveLength(1);
    expect(r.spots[0].ticked).toBe(TODAY);
    // Ticked spots aren't counted again.
    spots = passes(r.spots, { first: 29, last: 31 }, 3).spots;
    expect(spots[0].alone).toBe(7);
  });

  it('alone needs a clean lap; laps that miss the spot or only overlap it do not count', () => {
    const spots = addSpot([], { first: 29, last: 31 }, TODAY);
    expect(passes(spots, { first: 29, last: 31 }, 1, new Set([29])).spots[0].alone).toBe(0);
    expect(passes(spots, { first: 30, last: 30 }, 1).spots[0].alone).toBe(1);
    expect(passes(spots, { first: 1, last: 10 }, 1).spots[0]).toMatchObject({ alone: 0, inContext: 0 });
    expect(passes(spots, { first: 30, last: 35 }, 1).spots[0]).toMatchObject({ alone: 0, inContext: 0 });
  });

  it('uses the setting: need 2 ticks off sooner', () => {
    const spots = addSpot([], { first: 29, last: 31 }, TODAY);
    const r = passes(passes(spots, { first: 29, last: 31 }, 2, none, 2).spots, { first: 28, last: 32 }, 2, none, 2);
    expect(r.ticked).toHaveLength(1);
  });

  it('keeps ticked spots on show for 7 days', () => {
    const s = (ticked: string) => ({ first: 1, last: 2, alone: 5, inContext: 5, added: '2026-11-01', ticked });
    expect(prune([s('2026-11-11'), s('2026-11-10')], TODAY).map((x) => x.ticked)).toEqual(['2026-11-11']);
  });

  it('auto-adds bars in his range over the threshold, 3 at a time, not twice', () => {
    const bars = [
      { bar: 30, misses: 2, hesitations: 1 }, { bar: 31, misses: 3, hesitations: 0 }, { bar: 10, misses: 9, hesitations: 0 },
      { bar: 34, misses: 1, hesitations: 1 }, { bar: 22, misses: 3, hesitations: 0 }, { bar: 25, misses: 0, hesitations: 4 },
      { bar: 38, misses: 5, hesitations: 0 },
    ];
    const r = autoSpots([], [], bars, { first: 21, last: 42 }, WHOLE, Date.now(), TODAY, () => 0);
    // 31 sits inside the 29-31 spot already; 10 is outside his range; 34 is under 3.
    expect(r.added).toEqual([{ first: 29, last: 31 }, { first: 21, last: 23 }, { first: 24, last: 26 }]);
    expect(r.spots.every((sp) => sp.auto)).toBe(true);
  });

  it('leaves a spot he removed this week alone unless it got bad again', () => {
    const now = Date.now();
    const bars = [{ bar: 30, misses: 4, hesitations: 0 }];
    const gone = [{ first: 29, last: 31, at: now - 1000 }];
    expect(autoSpots([], gone, bars, WHOLE, WHOLE, now, TODAY, () => 2).added).toEqual([]);
    expect(autoSpots([], gone, bars, WHOLE, WHOLE, now, TODAY, () => 3).added).toEqual([{ first: 29, last: 31 }]);
    const old = [{ first: 29, last: 31, at: now - 8 * 86_400_000 }];
    expect(autoSpots([], old, bars, WHOLE, WHOLE, now, TODAY, () => 0).added).toEqual([{ first: 29, last: 31 }]);
  });

  it('labels', () => {
    const sp = { first: 29, last: 31, alone: 7, inContext: 2, added: TODAY };
    expect(spotLabel(sp, 5)).toBe('Bars 29–31 · alone 5/5 · in context 2/5');
    expect(spotLabel({ ...sp, ticked: '2026-11-08' }, 5)).toBe('✓ Bars 29–31 · off 11/8');
  });
});
