import { describe, expect, it, vi } from 'vitest';

// Tone touches the Web Audio API at import; only the constants are under test here.
vi.mock('tone', () => ({}));

import { MISS_FLOOR_MS, MISS_SOUND, MISS_SOUNDS, MISS_VOLUME_DEFAULT, MISS_VOLUME_MAX, missGateOpen, missVolumeDb } from '../src/renderer/audio/AudioEngine';
import { MISS_KINDS, MISS_KIND_DEFAULT } from '../src/renderer/audio/missKinds';

describe('miss sound (#6047, #5799)', () => {
  it('has nothing under 250 Hz, which TV and laptop speakers cannot play (the old thud was 110 Hz)', () => {
    for (const kind of MISS_KINDS) {
      const spec = MISS_SOUNDS[kind];
      expect(spec.lowCutHz).toBeGreaterThanOrEqual(250);
      for (const t of spec.tones) expect(Math.min(t.hz, t.endHz)).toBeGreaterThanOrEqual(250);
      if (spec.noise) expect(spec.noise.hz).toBeGreaterThanOrEqual(1000);
    }
    expect(MISS_SOUND).toBe(MISS_SOUNDS.knock);
  });

  it('the default and the Buzz sit in the 2-4 kHz band, well above where a piano is loudest', () => {
    for (const kind of ['click', 'buzz'] as const) {
      const spec = MISS_SOUNDS[kind];
      expect(spec.lowCutHz).toBeGreaterThanOrEqual(1000);
      for (const t of spec.tones) {
        expect(t.hz).toBeGreaterThanOrEqual(1900);
        expect(t.endHz).toBeGreaterThanOrEqual(1700);
        expect(t.hz).toBeLessThanOrEqual(4000);
      }
    }
    expect(MISS_KIND_DEFAULT).toBe('click');
    expect(MISS_KINDS).toEqual(['click', 'buzz', 'knock']);
  });

  it('is short: a cue, not an alarm', () => {
    for (const kind of MISS_KINDS) {
      const spec = MISS_SOUNDS[kind];
      expect(spec.seconds).toBeGreaterThanOrEqual(0.08);
      expect(spec.seconds).toBeLessThanOrEqual(0.2);
      if (spec.noise) expect(spec.noise.decay).toBeLessThanOrEqual(spec.seconds);
      for (const t of spec.tones) expect(t.at + t.decay).toBeLessThanOrEqual(spec.seconds);
    }
  });

  it('starts at full volume; the slider turns it down, or up to +6 dB of soft-clipped headroom', () => {
    expect(MISS_VOLUME_DEFAULT).toBe(100);
    expect(MISS_VOLUME_MAX).toBe(200);
    expect(missVolumeDb(100)).toBe(0);
    expect(missVolumeDb(50)).toBeCloseTo(-6.02, 1);
    expect(missVolumeDb(200)).toBeCloseTo(6.02, 1);
    expect(missVolumeDb(0)).toBeNull();
    expect(missVolumeDb(-5)).toBeNull();
    expect(missVolumeDb(900)).toBeCloseTo(6.02, 1);
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
