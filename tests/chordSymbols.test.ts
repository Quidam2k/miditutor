import { describe, it, expect } from 'vitest';
import { chordSymbol, playsChord } from '../src/renderer/components/score/chordSymbols';

describe('chord symbols', () => {
  it('builds the pitch classes and label of a slash chord', () => {
    const gOverB = chordSymbol(7, 0, 11)!;
    expect(gOverB.label).toBe('G/B');
    expect([...gOverB.pcs].sort((a, b) => a - b)).toEqual([2, 7, 11]);
  });

  it('adds a bass outside the chord (C/Bb)', () => {
    expect([...chordSymbol(0, 0, 10)!.pcs].sort((a, b) => a - b)).toEqual([0, 4, 7, 10]);
  });

  it('labels minor and seventh kinds, flats for black-key roots', () => {
    expect(chordSymbol(4, 1)!.label).toBe('Em');
    expect(chordSymbol(10, 4)!.label).toBe('Bb7');
  });

  it('returns null for kinds it does not model', () => {
    expect(chordSymbol(0, 24)).toBeNull();
  });

  it('matches in any octave, inversion or order, and needs every tone', () => {
    const am = chordSymbol(9, 1)!;
    expect(playsChord(am, [48, 57, 64])).toBe(true); // C3 A3 E4
    expect(playsChord(am, [45, 52, 60, 64, 69])).toBe(true); // with doublings
    expect(playsChord(am, [57, 64])).toBe(false); // no C
  });
});
