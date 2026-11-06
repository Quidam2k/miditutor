import { describe, it, expect } from 'vitest';
import { keyNameOfFifths, miniDuration, miniStaffPlacements } from '../src/renderer/components/score/MiniStaff';
import { keyCenterPct } from '../src/renderer/components/homework/PianoKeyboard88';

describe('mini staff above the keyboard (#5624)', () => {
  it('names the key from the signature, clamped', () => {
    expect(keyNameOfFifths(-3)).toBe('Eb');
    expect(keyNameOfFifths(0)).toBe('C');
    expect(keyNameOfFifths(2)).toBe('D');
    expect(keyNameOfFifths(9)).toBe('C#');
  });
  it('sits over the keys being played', () => {
    expect(keyCenterPct(21)).toBeLessThan(2);
    expect(keyCenterPct(108)).toBeGreaterThan(98);
    expect(keyCenterPct(60)).toBeGreaterThan(40);
    expect(keyCenterPct(60)).toBeLessThan(50);
  });
});

describe('miniDuration (#11092)', () => {
  it('reads the written type and its dots', () => {
    expect(miniDuration(1 / 4, 0)).toEqual({ duration: 'q', dots: 0 });
    expect(miniDuration(1 / 8, 0)).toEqual({ duration: '8', dots: 0 });
    expect(miniDuration(1 / 2, 1)).toEqual({ duration: 'h', dots: 1 });
  });
  it('works out dots when the length already includes them', () => {
    expect(miniDuration(3 / 8, undefined)).toEqual({ duration: 'q', dots: 1 });
    expect(miniDuration(undefined, undefined, 3 / 4)).toEqual({ duration: 'h', dots: 1 });
    expect(miniDuration(undefined, undefined, 7 / 16)).toEqual({ duration: 'q', dots: 2 });
  });
  it('falls back to a quarter', () => {
    expect(miniDuration(undefined, undefined)).toEqual({ duration: 'q', dots: 0 });
  });
});

const note = { note: 'C' as const, octave: 4, midiNumber: 60, duration: 'q', dots: 0 };

describe('miniStaffPlacements (#11091)', () => {
  it('puts each hand over its own keys', () => {
    const out = miniStaffPlacements({ clef: 'treble', notes: [note], pct: 60 }, { clef: 'bass', notes: [note], pct: 25 });
    expect(out.map((p) => [p.hand, p.pct, p.align])).toEqual([['right', 60, 'center'], ['left', 25, 'center']]);
  });
  it('parts close hands at the midpoint, left hand to the left', () => {
    const out = miniStaffPlacements({ clef: 'treble', notes: [note], pct: 52 }, { clef: 'bass', notes: [note], pct: 46 });
    expect(out.map((p) => [p.hand, p.pct, p.align])).toEqual([['right', 49, 'left'], ['left', 49, 'right']]);
  });
  it('drops a hand with nothing on the beat, keeps one that rests', () => {
    const rest = { duration: 'q', dots: 0 };
    expect(miniStaffPlacements({ clef: 'treble', notes: [note], pct: 60 }, { clef: 'bass', notes: [], pct: 0 })).toHaveLength(1);
    expect(miniStaffPlacements({ clef: 'treble', notes: [note], pct: 60 }, { clef: 'bass', notes: [], rest, pct: 30 })).toHaveLength(2);
  });
});
