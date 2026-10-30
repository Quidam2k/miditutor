import { describe, it, expect } from 'vitest';
import { keyPitchClass, scaleOffsets, type ScaleType } from '../src/renderer/engine/Homework';
import { scaleFingers, type Hand } from '../src/renderer/engine/ScaleFingering';

const KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
const TYPES: ScaleType[] = ['major', 'natural', 'harmonic', 'melodic'];
const HANDS: Hand[] = ['RH', 'LH'];
const BLACK = new Set([1, 3, 6, 8, 10]);

const every: [string, ScaleType, Hand][] = KEYS.flatMap((k) =>
  TYPES.flatMap((t) => HANDS.map((h): [string, ScaleType, Hand] => [k, t, h])));

describe('scaleFingers', () => {
  const E_RH_UP = [1, 2, 3, 1, 2, 3, 4, 1, 2, 3, 1, 2, 3, 4, 5];
  const E_LH_UP = [5, 4, 3, 2, 1, 3, 2, 1, 4, 3, 2, 1, 3, 2, 1];

  it.each(['natural', 'harmonic', 'melodic'] as ScaleType[])('E minor %s, both hands, both ways', (type) => {
    expect(scaleFingers('E', type, 'RH')).toEqual([...E_RH_UP, ...E_RH_UP.slice(0, -1).reverse()]);
    expect(scaleFingers('E', type, 'LH')).toEqual([...E_LH_UP, ...E_LH_UP.slice(0, -1).reverse()]);
  });

  it('Bb major keeps the fourth finger on Bb', () => {
    expect(scaleFingers('Bb', 'major', 'RH')?.slice(0, 15)).toEqual([2, 1, 2, 3, 1, 2, 3, 4, 1, 2, 3, 1, 2, 3, 4]);
  });

  it.each(every)('%s %s %s lines up with the notes and is playable', (key, type, hand) => {
    const fingers = scaleFingers(key, type, hand);
    if (!fingers) return; // No entry means no numbers; the list below pins which ones.
    const offsets = scaleOffsets(type);
    expect(fingers).toHaveLength(offsets.length);
    const tonic = keyPitchClass(key);
    fingers.forEach((f, i) => {
      expect(f).toBeGreaterThanOrEqual(1);
      expect(f).toBeLessThanOrEqual(5);
      if (i > 0) expect(f, `same finger twice at ${i}`).not.toBe(fingers[i - 1]);
      if (f === 1) expect(BLACK.has((tonic + offsets[i] + 120) % 12), `thumb on black at ${i}`).toBe(false);
    });
  });

  it('only C# and F# melodic RH have no numbers', () => {
    const missing = every.filter(([k, t, h]) => !scaleFingers(k, t, h)).map((e) => e.join(' '));
    expect(missing).toEqual(['C# melodic RH', 'F# melodic RH']);
  });

  it('accepts enharmonic names and refuses bad ones', () => {
    expect(scaleFingers('Gb', 'major', 'RH')).toEqual(scaleFingers('F#', 'major', 'RH'));
    expect(scaleFingers('H', 'major', 'RH')).toBeNull();
  });
});
