import { describe, it, expect } from 'vitest';
import { waveDelays } from '../src/renderer/components/score/WaveOverlay';

describe('waveDelays (#5521)', () => {
  it('nothing in, nothing out', () => expect(waveDelays([])).toEqual([]));
  it('one beat apart = 90 ms apart, chord notes together', () => expect(waveDelays([4, 4, 5, 6])).toEqual([0, 0, 90, 180]));
  it('a long loop is squeezed into 1.2 s', () => expect(waveDelays([0, 50, 100])).toEqual([0, 600, 1200]));
  it('all on one beat: all at once', () => expect(waveDelays([3, 3])).toEqual([0, 0]));
});
