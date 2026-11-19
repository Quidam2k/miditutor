import { describe, it, expect } from 'vitest';
import { hintsSnapshot, sameHints, type HintFlags } from '../src/renderer/engine/HintsState';

const base: HintFlags = {
  showKeyboard: true, trainingWheels: false, miniStaff: true, hintsOffNew: true,
  quietNew: false, bare: false, readAhead: false, keeping: false,
};

describe('hints state for the practice history (#5853)', () => {
  it('everything on by default', () => {
    expect(hintsSnapshot(base)).toMatchObject({ keys: 'always', names: 'always', mini: 'always' });
  });
  it('training wheels: keys fade, names and mini staff stay', () => {
    expect(hintsSnapshot({ ...base, trainingWheels: true })).toMatchObject({ keys: 'wheels', names: 'always', mini: 'always' });
  });
  it('keyboard hidden: no key lights and no mini staff', () => {
    expect(hintsSnapshot({ ...base, showKeyboard: false })).toMatchObject({ keys: 'none', names: 'always', mini: 'none' });
  });
  it('5 min, no hints: nothing', () => {
    expect(hintsSnapshot({ ...base, bare: true, trainingWheels: true })).toMatchObject({ keys: 'none', names: 'none', mini: 'none' });
  });
  it('a new piece with hints off, or read ahead: only after a pause or miss', () => {
    for (const f of [{ quietNew: true }, { readAhead: true }]) {
      expect(hintsSnapshot({ ...base, ...f })).toMatchObject({ keys: 'on-pause', names: 'on-pause', mini: 'on-pause' });
    }
  });
  it('keep going darkens the keys only', () => {
    expect(hintsSnapshot({ ...base, keeping: true })).toMatchObject({ keys: 'none', names: 'always', mini: 'always' });
  });
  it('sameHints sees any change', () => {
    const a = hintsSnapshot(base);
    expect(sameHints(null, a)).toBe(false);
    expect(sameHints(a, hintsSnapshot(base))).toBe(true);
    expect(sameHints(a, hintsSnapshot({ ...base, hintsOffNew: false }))).toBe(false);
  });
});
