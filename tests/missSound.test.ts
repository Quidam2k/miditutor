import { describe, expect, it, vi } from 'vitest';

// Tone touches the Web Audio API at import; only the constants are under test here.
vi.mock('tone', () => ({}));

import { MISS_FLOOR_MS, MISS_SOUND, MISS_VOLUME_DEFAULT, missGateOpen, missVolumeDb } from '../src/renderer/audio/AudioEngine';

describe('miss sound (#6047)', () => {
  it('has nothing under 250 Hz, which TV and laptop speakers cannot play (the old thud was 110 Hz)', () => {
    expect(MISS_SOUND.lowCutHz).toBeGreaterThanOrEqual(250);
    expect(MISS_SOUND.tone.endHz).toBeGreaterThanOrEqual(250);
    expect(MISS_SOUND.noise.hz).toBeGreaterThanOrEqual(1000);
  });

  it('is short: a cue, not an alarm', () => {
    expect(MISS_SOUND.seconds).toBeGreaterThanOrEqual(0.08);
    expect(MISS_SOUND.seconds).toBeLessThanOrEqual(0.2);
    expect(MISS_SOUND.noise.decay).toBeLessThanOrEqual(MISS_SOUND.seconds);
    expect(MISS_SOUND.tone.decay).toBeLessThanOrEqual(MISS_SOUND.seconds);
  });

  it('starts at full volume and the slider only turns it down', () => {
    expect(MISS_VOLUME_DEFAULT).toBe(100);
    expect(missVolumeDb(100)).toBe(0);
    expect(missVolumeDb(50)).toBeCloseTo(-6.02, 1);
    expect(missVolumeDb(0)).toBeNull();
    expect(missVolumeDb(-5)).toBeNull();
    expect(missVolumeDb(250)).toBe(0);
    expect(missVolumeDb(Number.NaN)).toBe(0);
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
