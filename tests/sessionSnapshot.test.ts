import { describe, expect, it } from 'vitest';
import { RESTORE_MAX_AGE_MS, restorable } from '../src/renderer/components/score/sessionSnapshot';
import { practiceLabel, parseTally, tallyNote, PRACTICE_IDLE_MS, PRACTICE_RESET_MS } from '../src/renderer/engine/PracticeTally';
import { rangeEdited, startChunk } from '../src/renderer/engine/BackwardChunk';
import { parseBar } from '../src/renderer/components/score/noteEdit';

const NOW = 1_000_000_000;
const chunk = { first: 22, last: 30, start: 24, clean: 2, need: 5, done: false };
const snap = {
  at: NOW - 1000, pieceId: 'file:s.musicxml', pieceLabel: 'S', loop: { first: 24, last: 30 }, chunk,
  lap: 2, wrongCount: 3, lapWrong: 1, step: 40, hand: 'left', following: true, showOriginal: true,
};

describe('restorable (#10236)', () => {
  it('a recent snapshot comes back whole', () => {
    expect(restorable(snap, false, NOW)).toEqual(snap);
  });

  it('an ordinary launch drops an old one; a patch relaunch keeps it', () => {
    const old = { ...snap, at: NOW - RESTORE_MAX_AGE_MS - 1 };
    expect(restorable(old, false, NOW)).toBeNull();
    expect(restorable(old, true, NOW)).toEqual(old);
  });

  it('a clock that went backwards is not recent', () => {
    expect(restorable({ ...snap, at: NOW + 5000 }, false, NOW)).toBeNull();
    expect(restorable({ ...snap, at: NOW + 5000 }, true, NOW)).not.toBeNull();
  });

  it('nothing, or not ours: nothing', () => {
    for (const bad of [null, 'x', 3, {}, { at: NOW }, { pieceId: 'p' }]) expect(restorable(bad, true, NOW)).toBeNull();
  });

  it('bad fields fall back quietly', () => {
    const got = restorable({ at: NOW, pieceId: 'p', loop: { first: 9, last: 2 }, chunk, lap: -1, wrongCount: 'x', step: 1.5, hand: 'nose' }, false, NOW);
    expect(got).toMatchObject({ loop: null, chunk: null, lap: 1, wrongCount: 0, step: 0, hand: 'both', following: true, showOriginal: false });
  });

  it('a chunk must match the loop it runs on', () => {
    expect(restorable({ ...snap, loop: { first: 25, last: 30 } }, false, NOW)?.chunk).toBeNull();
  });
});

describe('practice tally (#10240)', () => {
  it('counts from the first note, and leaves out a gap over the idle rule', () => {
    let t = tallyNote(null, 0);
    expect(t.totalMs).toBe(0);
    t = tallyNote(t, 60000);
    expect(t.totalMs).toBe(60000);
    t = tallyNote(t, 60000 + PRACTICE_IDLE_MS);
    expect(t.totalMs).toBe(60000 + PRACTICE_IDLE_MS);
    t = tallyNote(t, 60000 + PRACTICE_IDLE_MS + PRACTICE_IDLE_MS + 1);
    expect(t.totalMs).toBe(60000 + PRACTICE_IDLE_MS);
  });

  it('a clock set back keeps the count', () => {
    expect(tallyNote({ lastNoteAt: 5000, totalMs: 900 }, 4000)).toEqual({ lastNoteAt: 4000, totalMs: 900 });
  });

  it('a long time away starts over', () => {
    const t = tallyNote({ lastNoteAt: 0, totalMs: 500000 }, PRACTICE_RESET_MS + 1);
    expect(t).toEqual({ lastNoteAt: PRACTICE_RESET_MS + 1, totalMs: 0 });
  });

  it('labels hours and minutes', () => {
    expect(practiceLabel(0)).toBe('0:00');
    expect(practiceLabel(7 * 60000 + 59000)).toBe('0:07');
    expect(practiceLabel(83 * 60000)).toBe('1:23');
  });

  it('reads back only a good tally', () => {
    expect(parseTally(null)).toBeNull();
    expect(parseTally('{bad')).toBeNull();
    expect(parseTally('{"lastNoteAt":"x","totalMs":1}')).toBeNull();
    expect(parseTally('{"lastNoteAt":5,"totalMs":1}')).toEqual({ lastNoteAt: 5, totalMs: 1 });
  });
});

describe('typed bars (#10236)', () => {
  const T = [3, 5];
  it('a new first bar keeps his progress', () => {
    expect(rangeEdited(chunk, 20, 30, T)).toEqual({ ...chunk, first: 20 });
  });

  it('a first bar past the chunk moves the chunk up to it, and that chunk starts clean', () => {
    expect(rangeEdited(chunk, 26, 30, T)).toEqual({ first: 26, last: 30, start: 26, clean: 0, need: 5, done: false });
  });

  it('a new last bar starts over from that bar', () => {
    expect(rangeEdited(chunk, 22, 32, T)).toEqual(startChunk(22, 32, T));
  });

  it('widening a finished range is no longer finished', () => {
    const done = { ...chunk, start: 22, done: true };
    expect(rangeEdited(done, 20, 30, T).done).toBe(false);
  });

  it('reads a bar number, or nothing', () => {
    expect(parseBar(' 25 ')).toBe(25);
    for (const bad of ['', '0', '-1', '2.5', 'x', '12345']) expect(parseBar(bad)).toBeNull();
  });
});
