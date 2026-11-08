import { describe, it, expect } from 'vitest';
import { chordChanges, movedBy } from '../src/renderer/engine/ChordMoves';
import type { BlockStep } from '../src/renderer/engine/Blocking';

const L = (step: number, bar: number, ...midis: number[]): BlockStep => ({ step, bar, notes: midis.map((midi) => ({ midi, hand: 'L' as const })) });
const R = (step: number, bar: number, ...midis: number[]): BlockStep => ({ step, bar, notes: midis.map((midi) => ({ midi, hand: 'R' as const })) });

describe('chordChanges', () => {
  it('C to F triad (C E G -> C F A): C stays, E and G each move up', () => {
    const [c] = chordChanges([L(0, 1, 48, 52, 55), L(1, 1, 48, 53, 57)], 'L');
    expect(c.voices).toEqual([
      { midi: 48, kind: 'stay', by: 0 },
      { midi: 53, kind: 'move', by: 1 },
      { midi: 57, kind: 'move', by: 2 },
    ]);
    expect(c).toMatchObject({ step: 1, fromStep: 0, bar: 1, shift: null, same: false });
  });

  it('a whole-hand shift is named, and a repeat of the same move is a pattern', () => {
    const cs = chordChanges([L(0, 1, 48, 52), L(1, 1, 50, 54), L(2, 2, 52, 56), L(3, 2, 53, 58)], 'L');
    expect(cs.map((c) => c.shift)).toEqual([2, 2, null]);
    expect(cs.map((c) => c.same)).toEqual([false, true, false]);
  });

  it('only that hand, only chords: single notes and the other hand are skipped', () => {
    const steps = [L(0, 1, 48, 52), R(1, 1, 72, 76), L(2, 1, 50), { step: 3, bar: 1, notes: [{ midi: 48, hand: 'L' as const }, { midi: 53, hand: 'L' as const }, { midi: 79, hand: 'R' as const }] }];
    const cs = chordChanges(steps, 'L');
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ step: 3, fromStep: 0 });
    expect(chordChanges(steps, 'R')).toEqual([]);
  });

  it('chords more than a bar apart are not compared, and that breaks a pattern', () => {
    const cs = chordChanges([L(0, 1, 48, 52), L(1, 1, 50, 54), L(2, 4, 48, 52), L(3, 4, 50, 54)], 'L');
    expect(cs.map((c) => c.step)).toEqual([1, 3]);
    expect(cs.map((c) => c.same)).toEqual([false, false]);
  });

  it('the same chord again is skipped and keeps the pattern going', () => {
    const cs = chordChanges([L(0, 1, 48, 52), L(1, 1, 50, 54), L(2, 1, 50, 54), L(3, 2, 52, 56)], 'L');
    expect(cs.map((c) => c.step)).toEqual([1, 3]);
    expect(cs[1].same).toBe(true);
  });

  it('more notes than before: the extra is new when nothing left; otherwise from the nearest key that left', () => {
    const [grow] = chordChanges([L(0, 1, 48, 55), L(1, 1, 48, 52, 55)], 'L');
    expect(grow.voices.map((v) => v.kind)).toEqual(['stay', 'new', 'stay']);
    const [spread] = chordChanges([L(0, 1, 48, 55), L(1, 1, 47, 50, 55)], 'L');
    expect(spread.voices).toEqual([
      { midi: 47, kind: 'move', by: -1 },
      { midi: 50, kind: 'move', by: 2 },
      { midi: 55, kind: 'stay', by: 0 },
    ]);
    expect(spread.shift).toBeNull();
  });

  it('movedBy signs the distance', () => {
    expect([movedBy(2), movedBy(-1)]).toEqual(['+2', '-1']);
  });
});
