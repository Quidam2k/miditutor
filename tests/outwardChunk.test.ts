import { describe, expect, it } from 'vitest';
import type { ChunkState } from '../src/renderer/engine/BackwardChunk';
import {
  MAX_STARS, outerFor, outwardGrewLabel, outwardLabel, outwardLapDone, outwardRangeEdited, starsInOrder, starsOf, startOutward, toggleSpan,
} from '../src/renderer/engine/OutwardChunk';

const T = [3, 5];
const WHOLE = { first: 1, last: 60 };

function laps(s: ChunkState, wrongs: number[]) {
  const grew: boolean[] = [];
  const reached: boolean[] = [];
  for (const w of wrongs) {
    const r = outwardLapDone(s, w, T);
    s = r.state;
    grew.push(r.grew);
    reached.push(r.reached);
  }
  return { s, grew, reached };
}

describe('OutwardChunk', () => {
  it('grows toward the smallest starred span strictly around the core, else the whole piece', () => {
    const stars = [{ first: 21, last: 42 }, { first: 29, last: 31 }, { first: 25, last: 35 }, { first: 40, last: 50 }];
    expect(outerFor({ first: 29, last: 31 }, stars, WHOLE)).toEqual({ first: 25, last: 35 });
    expect(outerFor({ first: 22, last: 24 }, stars, WHOLE)).toEqual({ first: 21, last: 42 });
    expect(outerFor({ first: 52, last: 53 }, stars, WHOLE)).toEqual(WHOLE);
    expect(outerFor({ first: 21, last: 42 }, stars, WHOLE)).toEqual(WHOLE);
    expect(outerFor({ first: 31, last: 29 }, [{ first: 29, last: 30 }, ...stars], WHOLE)).toEqual({ first: 25, last: 35 });
    expect(outerFor({ first: 55, last: 58 }, [{ first: 50, last: 90 }], WHOLE)).toEqual({ first: 50, last: 60 });
  });

  it('starts on the core with the first target', () => {
    const s = startOutward({ first: 29, last: 31 }, { first: 21, last: 42 }, T);
    expect(s).toMatchObject({ first: 21, last: 42, start: 29, end: 31, clean: 0, need: 3, done: false, out: true, grown: 0 });
    expect(outwardLabel(s)).toBe('Outward: bars 29–31 of 21–42 · clean 0/3');
  });

  it('adds a bar each side after 3 clean laps; a wrong lap neither counts nor shrinks it', () => {
    const s0 = startOutward({ first: 29, last: 31 }, { first: 21, last: 42 }, T);
    const { s, grew } = laps(s0, [0, 1, 0, 0]);
    expect(grew).toEqual([false, false, false, true]);
    expect(s).toMatchObject({ start: 28, end: 32, clean: 0, need: 5, grown: 1 });
    expect(outwardGrewLabel(s)).toBe('Grew: now looping 28–32, 5 clean laps to go');
  });

  it('grows one way once an edge reaches the outer span, then finishes once', () => {
    const s0 = startOutward({ first: 21, last: 22 }, { first: 21, last: 24 }, T);
    let r = laps(s0, [0, 0, 0]);
    expect(r.s).toMatchObject({ start: 21, end: 23 });
    r = laps(r.s, [0, 0, 0, 0, 0]);
    expect(r.s).toMatchObject({ start: 21, end: 24, done: false });
    r = laps(r.s, [0, 0, 0, 0, 0, 0, 0]);
    expect(r.reached).toEqual([false, false, false, false, true, false, false]);
    expect(r.s.done).toBe(true);
    expect(outwardLabel(r.s)).toBe('Outward: whole range 21–24 · 7 clean laps');
  });

  it('a new outer span keeps progress when the loop still fits, and clamps it when not', () => {
    const s = laps(startOutward({ first: 29, last: 31 }, { first: 21, last: 42 }, T), [0, 0, 0]).s;
    expect(outwardRangeEdited(s, 20, 45, T)).toMatchObject({ first: 20, last: 45, start: 28, end: 32, grown: 1 });
    expect(outwardRangeEdited(s, 30, 45, T)).toMatchObject({ first: 30, last: 45, start: 30, end: 32, clean: 0 });
    expect(outwardRangeEdited(s, 50, 55, T)).toMatchObject({ start: 50, end: 50 });
  });
});

describe('starred spans', () => {
  it('stars, unstars, caps the list and lists shortest first', () => {
    let list = toggleSpan([], { first: 42, last: 21 });
    expect(list).toEqual([{ first: 21, last: 42 }]);
    list = toggleSpan(list, { first: 29, last: 31 });
    expect(starsInOrder(list)).toEqual([{ first: 29, last: 31 }, { first: 21, last: 42 }]);
    expect(toggleSpan(list, { first: 21, last: 42 })).toEqual([{ first: 29, last: 31 }]);
    for (let i = 1; i <= 10; i++) list = toggleSpan(list, { first: i, last: i });
    expect(list).toHaveLength(MAX_STARS);
    expect(list[0]).toEqual({ first: 3, last: 3 });
    expect(starsOf({}, 'constructor')).toEqual([]);
  });
});

describe('relaunch restore', () => {
  it('keeps an outward drill on the loop it runs (start..end)', async () => {
    const { restorable } = await import('../src/renderer/components/score/sessionSnapshot');
    const chunk = { first: 21, last: 42, start: 28, end: 32, clean: 1, need: 5, done: false, out: true, grown: 1 };
    const snap = { at: 1000, pieceId: 'p', pieceLabel: 'P', chunk, lap: 3, wrongCount: 0, lapWrong: 0, step: 4 };
    expect(restorable({ ...snap, loop: { first: 28, last: 32 } }, false, 2000)?.chunk).toEqual(chunk);
    expect(restorable({ ...snap, loop: { first: 28, last: 42 } }, false, 2000)?.chunk).toBeNull();
  });
});
