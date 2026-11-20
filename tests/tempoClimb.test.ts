import { describe, it, expect } from 'vitest';
import {
  startClimb,
  climbLap,
  climbPercent,
  climbLabel,
  parseTempo,
} from '../src/renderer/engine/TempoClimb';
import type { Climb, Reaction } from '../src/renderer/engine/TempoClimb';
import { MIN_BPM } from '../src/renderer/engine/KeepGoing';

function lap(c: Climb, m: number, sec: number, reaction: Reaction = 'normal', notes = 10) {
  return climbLap(c, { bpm: c.bpm, missed: m, wrong: 0, notes }, sec, reaction);
}

describe('startClimb', () => {
  it('defaults to 70% of the target', () => {
    const c = startClimb(100, null);
    expect(c.target).toBe(100);
    expect(c.start).toBe(70);
    expect(c.bpm).toBe(70);
    expect(c.peak).toBe(70);
    expect(c.streak).toBe(0);
    expect(c.secAtBpm).toBe(0);
    expect(c.reached).toBe(false);
  });

  it('uses recentClean when valid', () => {
    expect(startClimb(100, 85).start).toBe(85);
  });

  it('caps recentClean at the target', () => {
    const c = startClimb(100, 130);
    expect(c.start).toBe(100);
    expect(c.reached).toBe(false);
  });

  it('ignores invalid recentClean', () => {
    expect(startClimb(100, 0).start).toBe(70);
    expect(startClimb(100, NaN).start).toBe(70);
    expect(startClimb(100, -5).start).toBe(70);
  });

  it('never goes below MIN_BPM', () => {
    expect(startClimb(1, null).start).toBeGreaterThanOrEqual(MIN_BPM);
    expect(startClimb(1, 1).bpm).toBeGreaterThanOrEqual(MIN_BPM);
  });
});

describe('climbLap (normal)', () => {
  it('does not go up on 40 s but does on 60 s', () => {
    let c = startClimb(100, 80);
    let r = lap(c, 0, 20);
    expect(r.change).toBe('hold');
    r = lap(r.climb, 0, 20);
    expect(r.change).toBe('hold');
    expect(r.climb.bpm).toBe(80);
    r = lap(r.climb, 0, 20);
    expect(r.change).toBe('up');
    expect(r.climb.bpm).toBe(84);
    expect(r.climb.peak).toBe(84);
    expect(r.climb.streak).toBe(0);
    expect(r.climb.secAtBpm).toBe(0);
  });

  it('a hold lap resets the streak but keeps seconds', () => {
    const c = startClimb(100, 80);
    let r = lap(c, 0, 20);
    expect(r.climb.streak).toBe(1);
    r = lap(r.climb, 2, 20);
    expect(r.change).toBe('hold');
    expect(r.climb.streak).toBe(0);
    expect(r.climb.secAtBpm).toBe(40);
  });

  it('a bad lap goes down one step with a floor at start - 2 steps', () => {
    const c = startClimb(100, 80);
    let r = lap(c, 3, 20);
    expect(r.change).toBe('down');
    expect(r.climb.bpm).toBe(76);
    r = lap(r.climb, 3, 20);
    expect(r.climb.bpm).toBe(72);
    r = lap(r.climb, 3, 20);
    expect(r.change).toBe('hold');
    expect(r.climb.bpm).toBe(72);
  });

  it('counts wrong notes as misses', () => {
    const c = startClimb(100, 80);
    const r = climbLap(c, { bpm: 80, missed: 1, wrong: 2, notes: 10 }, 20, 'normal');
    expect(r.change).toBe('down');
  });

  it('does not mutate its input', () => {
    const c = startClimb(100, 80);
    const copy = { ...c };
    lap(c, 0, 60);
    expect(c).toEqual(copy);
  });

  it('reports reached once only', () => {
    let c = startClimb(60, 56);
    let r = lap(c, 0, 60);
    r = lap(r.climb, 0, 60);
    expect(r.change).toBe('up');
    expect(r.climb.bpm).toBe(60);
    r = lap(r.climb, 0, 60);
    expect(r.change).toBe('reached');
    expect(r.climb.reached).toBe(true);
    r = lap(r.climb, 3, 60);
    expect(r.change).toBe('down');
    expect(r.climb.bpm).toBe(56);
    expect(r.climb.reached).toBe(true);
    r = lap(r.climb, 0, 60);
    r = lap(r.climb, 0, 60);
    expect(r.change).toBe('up');
    expect(r.climb.bpm).toBe(60);
    r = lap(r.climb, 0, 60);
    expect(r.change).toBe('hold');
    expect(r.climb.reached).toBe(true);
  });

  it('ignores laps with no notes', () => {
    const c = startClimb(100, 80);
    const r = lap(c, 0, 60, 'normal', 0);
    expect(r.change).toBe('hold');
    expect(r.climb).toEqual(c);
  });
});

describe('climbLap (quick)', () => {
  it('goes up after one clean 30 s lap', () => {
    const c = startClimb(100, 80);
    const r = lap(c, 0, 30, 'quick');
    expect(r.change).toBe('up');
    expect(r.climb.bpm).toBe(86);
  });

  it('treats one miss as a hold, two as a bad lap', () => {
    const c = startClimb(100, 80);
    expect(lap(c, 1, 30, 'quick').change).toBe('hold');
    expect(lap(c, 2, 30, 'quick').change).toBe('down');
  });
});

describe('climbPercent', () => {
  const base = startClimb(100, 80);
  it('is 0 at the start', () => {
    expect(climbPercent(base)).toBe(0);
  });
  it('is 50 halfway', () => {
    expect(climbPercent({ ...base, bpm: 90 })).toBe(50);
  });
  it('is 100 at the target', () => {
    expect(climbPercent({ ...base, bpm: 100 })).toBe(100);
  });
  it('is 100 when target <= start', () => {
    expect(climbPercent(startClimb(100, 100))).toBe(100);
  });
});

describe('climbLabel', () => {
  const c = { ...startClimb(100, 80), bpm: 84 };
  it('words each change', () => {
    expect(climbLabel(c, 'up')).toBe('Clean! Up to ♩ = 84.');
    expect(climbLabel(c, 'down')).toBe('A rough lap: back to ♩ = 84.');
    expect(climbLabel(c, 'reached')).toBe('♩ = 100 reached!');
    expect(climbLabel(c, 'hold')).toBe('♩ = 84, aiming for 100.');
  });
});

describe('parseTempo', () => {
  it('matches the listed forms', () => {
    expect(parseTempo('Play at ♩=80')).toBe(80);
    expect(parseTempo('♩ = 80')).toBe(80);
    expect(parseTempo('q=80')).toBe(80);
    expect(parseTempo('80 bpm')).toBe(80);
    expect(parseTempo('80bpm')).toBe(80);
    expect(parseTempo('tempo 80')).toBe(80);
    expect(parseTempo('metronome 72')).toBe(72);
    expect(parseTempo('MM 60')).toBe(60);
    expect(parseTempo('M.M. 60')).toBe(60);
    expect(parseTempo('Tempo 90')).toBe(90);
  });

  it('does not match plain numbers', () => {
    expect(parseTempo('bars 5-8')).toBeNull();
    expect(parseTempo('page 2')).toBeNull();
    expect(parseTempo('')).toBeNull();
  });

  it('rejects out-of-range values', () => {
    expect(parseTempo('♩=10')).toBeNull();
    expect(parseTempo('300 bpm')).toBeNull();
  });

  it('returns the first valid match', () => {
    expect(parseTempo('bars 5-8, q=60 then 90 bpm')).toBe(60);
  });
});
