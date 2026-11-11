import { describe, expect, it, vi } from 'vitest';

// Tone touches the Web Audio API at import; only the constants are under test here.
vi.mock('tone', () => ({}));

import { MISS_SOUND } from '../src/renderer/audio/AudioEngine';

describe('miss sound level (#11561)', () => {
  it('is within 6 dB of a played note (-8 dB), where the old -30 dB tick was inaudible', () => {
    expect(MISS_SOUND.db).toBeGreaterThanOrEqual(-14);
    expect(MISS_SOUND.db).toBeLessThanOrEqual(-6);
  });

  it('is long enough to register and short enough to stay out of the music', () => {
    expect(MISS_SOUND.seconds).toBeGreaterThanOrEqual(0.12);
    expect(MISS_SOUND.seconds).toBeLessThanOrEqual(0.3);
  });
});
