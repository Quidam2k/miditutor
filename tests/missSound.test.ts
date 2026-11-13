import { describe, expect, it, vi } from 'vitest';

// Tone touches the Web Audio API at import; only the constants are under test here.
vi.mock('tone', () => ({}));

import { MISS_FLOOR_MS, MISS_SOUND, missGateOpen } from '../src/renderer/audio/AudioEngine';

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

describe('miss sound floor (#5799)', () => {
  it('lets the first wrong key of a session through', () => {
    expect(missGateOpen(Number.NEGATIVE_INFINITY, 0)).toBe(true);
  });

  it('merges keys struck inside the floor into one thud, then opens again', () => {
    expect(missGateOpen(1000, 1000 + MISS_FLOOR_MS - 1)).toBe(false);
    expect(missGateOpen(1000, 1000 + MISS_FLOOR_MS)).toBe(true);
  });

  it('is short enough that a run of wrong notes is a pulse, not a wall of noise', () => {
    expect(MISS_FLOOR_MS).toBeGreaterThanOrEqual(100);
    expect(MISS_FLOOR_MS).toBeLessThanOrEqual(150);
  });
});
