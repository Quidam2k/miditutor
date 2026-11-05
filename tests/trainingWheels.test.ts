import { describe, it, expect } from 'vitest';
import { hesitationMs, MIN_HESITATION_MS } from '../src/renderer/engine/TrainingWheels';

describe('hesitationMs (#5519)', () => {
  it('no pace yet: the floor', () => expect(hesitationMs([])).toBe(MIN_HESITATION_MS));
  it('twice his median step gap', () => expect(hesitationMs([700, 800, 900])).toBe(1600));
  it('a fast pace still waits the floor', () => expect(hesitationMs([200, 250, 300])).toBe(MIN_HESITATION_MS));
  it('one long pause does not stretch it (median, not mean)', () => expect(hesitationMs([700, 700, 9000])).toBe(1400));
  it('only the last 8 gaps count', () => expect(hesitationMs([5000, 5000, 5000, ...Array(8).fill(800)])).toBe(1600));
});
