import { describe, expect, it } from 'vitest';
import { chunkLabel, grewLabel, lapDone, parseTargets, reachedLabel, startChunk, targetFor } from '../src/renderer/engine/BackwardChunk';

const T = [3, 5];

function laps(s: ReturnType<typeof startChunk>, wrongs: number[], targets = T) {
  const grew: boolean[] = [];
  const reached: boolean[] = [];
  for (const w of wrongs) {
    const r = lapDone(s, w, targets);
    s = r.state;
    grew.push(r.grew);
    reached.push(r.reached);
  }
  return { s, grew, reached };
}

describe('BackwardChunk', () => {
  it('parses the clean-lap targets, defaulting to 3,5', () => {
    expect(parseTargets('3,5')).toEqual([3, 5]);
    expect(parseTargets(' 2 4, 6 ')).toEqual([2, 4, 6]);
    expect(parseTargets('')).toEqual([3, 5]);
    expect(parseTargets('x, 0, -2')).toEqual([3, 5]);
  });

  it('escalates: 3 for the first chunk, then 5 for every later one', () => {
    expect(targetFor(T, 0)).toBe(3);
    expect(targetFor(T, 1)).toBe(5);
    expect(targetFor(T, 7)).toBe(5);
  });

  it('starts on the last bar alone, even with the bars given reversed', () => {
    const s = startChunk(35, 22, T);
    expect(s).toMatchObject({ first: 22, last: 35, start: 35, clean: 0, need: 3, done: false });
    expect(chunkLabel(s)).toBe('Backwards: bar 35 · clean 0/3');
  });

  it('grows one bar after three clean laps, then needs five', () => {
    const { s, grew } = laps(startChunk(33, 35, T), [0, 0, 0]);
    expect(grew).toEqual([false, false, true]);
    expect(s).toMatchObject({ start: 34, clean: 0, need: 5 });
    expect(chunkLabel(s)).toBe('Backwards: bars 34–35 · clean 0/5');
  });

  it('a lap with a wrong note does not count and does not reset or shrink', () => {
    let { s } = laps(startChunk(33, 35, T), [0, 0, 0, 0, 0]); // grown to 34, clean 2
    expect(s).toMatchObject({ start: 34, clean: 2 });
    ({ s } = laps(s, [1, 4]));
    expect(s).toMatchObject({ start: 34, clean: 2, need: 5 });
  });

  it('reaches the whole range, then keeps counting clean laps', () => {
    let { s, grew } = laps(startChunk(34, 35, T), [0, 0, 0, 0, 0, 0, 0, 0]);
    expect(grew.filter(Boolean).length).toBe(1);
    expect(s).toMatchObject({ start: 34, done: true, clean: 5 });
    expect(chunkLabel(s)).toBe('Backwards: whole range 34–35 · 5 clean laps');
    ({ s } = laps(s, [0, 2, 0]));
    expect(s).toMatchObject({ start: 34, done: true, clean: 7 });
  });

  it('an edit to the targets applies to the chunk he is on', () => {
    let { s } = laps(startChunk(33, 35, T), [0, 0]); // bar 35, clean 2/3
    ({ s } = laps(s, [0], [5, 5]));
    expect(s).toMatchObject({ start: 35, clean: 3, need: 5 });
  });

  it('a one-bar section is done after its first target', () => {
    const { s } = laps(startChunk(5, 5, T), [0, 0, 0]);
    expect(s).toMatchObject({ start: 5, done: true, clean: 3 });
  });

  it('#5382: says reached on exactly the lap that finishes the whole range', () => {
    const { s, reached } = laps(startChunk(34, 35, T), [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
    // 3 clean on bar 35, grow; then 5 clean (one wrong lap in between) on 34–35.
    expect(reached).toEqual([false, false, false, false, false, false, false, false, true, false, false]);
    expect(s).toMatchObject({ done: true, clean: 7 });
    expect(reachedLabel({ ...s, clean: 5 })).toBe('Clean-lap target reached: bars 34–35, 5 clean laps.');
  });

  it('#5382: a wrong lap at the end does not reach; a one-bar section reaches on its target', () => {
    let r = laps(startChunk(5, 5, T), [0, 0, 1]);
    expect(r.reached).toEqual([false, false, false]);
    r = laps(r.s, [0]);
    expect(r.reached).toEqual([true]);
    expect(reachedLabel(r.s)).toBe('Clean-lap target reached: bar 5, 3 clean laps.');
  });

  it('#5382: names the bar it just added', () => {
    const { s } = laps(startChunk(33, 35, T), [0, 0, 0]);
    expect(grewLabel(s)).toBe('Added bar 34: now looping 34–35, 5 clean laps to go');
  });
});
