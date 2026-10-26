import { describe, it, expect } from 'vitest';
import { JP_INTERVALS, spellIntervalAbove, midiNumberToPitch, pitchToDisplayName } from '../src/renderer/engine/MusicTheory';
import { generateJpInterval, INTERVAL_RANGE } from '../src/renderer/engine/NoteGenerator';

const byShort = (s: string) => JP_INTERVALS.find((i) => i.short === s)!;
const above = (root: number, s: string) => {
  const p = spellIntervalAbove(midiNumberToPitch(root), byShort(s));
  return p && pitchToDisplayName(p);
};

describe("JP's interval set (#5059)", () => {
  it('is m2 through P8, thirteen intervals', () => {
    expect(JP_INTERVALS.map((i) => i.short)).toEqual(
      ['m2', 'M2', 'm3', 'M3', 'P4', 'A4', 'd5', 'P5', 'm6', 'M6', 'm7', 'M7', 'P8']);
  });

  it('spells by quality, not by the nearest black key', () => {
    expect(above(65, 'A4')).toBe('B4'); // F up an augmented 4th
    expect(above(71, 'd5')).toBe('F5'); // B up a diminished 5th
    expect(above(65, 'P4')).toBe('Bb4');
    expect(above(64, 'm3')).toBe('G4');
    expect(above(60, 'm3')).toBe('Eb4');
    expect(above(60, 'P8')).toBe('C5');
  });

  it('keeps each clef in its own range and never repeats an interval back to back', () => {
    let last: string | undefined;
    for (let i = 0; i < 300; i++) {
      for (const clef of ['treble', 'bass'] as const) {
        const { interval, notes: [lo, hi] } = generateJpInterval(clef, last);
        expect(interval.short).not.toBe(last);
        expect(hi.midiNumber - lo.midiNumber).toBe(interval.semitones);
        const [min, max] = INTERVAL_RANGE[clef];
        expect(lo.midiNumber).toBeGreaterThanOrEqual(min);
        expect(hi.midiNumber).toBeLessThanOrEqual(max);
        last = interval.short;
      }
    }
  });
});
