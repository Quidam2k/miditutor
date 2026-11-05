import { describe, it, expect } from 'vitest';
import { GRAZE_MS, ScoreFollower } from '../src/renderer/engine/ScoreFollower';
import type { ScoreStep } from '../src/renderer/engine/ScoreFollower';

const steps = (notes = [62, 60, 64, 65]): ScoreStep[] =>
  notes.map((n, i) => ({ notes: [n], beat: i, measure: 1 }));

describe('ScoreFollower graze and velocity filtering (#5516)', () => {
  it('rejects the logged 25 ms graze without credit or cursor movement', () => {
    // The grazed C must be struck again.
    const follower = new ScoreFollower(steps());
    expect(GRAZE_MS).toBe(80);
    expect(follower.grazeMs).toBe(GRAZE_MS);
    expect(follower.minVelocity).toBe(0);
    expect(follower.noteOn(62, 1000)).toMatchObject({ kind: 'advance', to: 1 });
    expect(follower.noteOn(60, 1025)).toMatchObject({ kind: 'stray', reason: 'graze' });
    expect(follower.index).toBe(1);
    expect([...follower.satisfied]).toEqual([]);
    expect(follower.noteOn(60, 1400)).toMatchObject({ kind: 'advance', from: 1, to: 2 });
  });

  it('accepts the slowest-safe real gap of 316 ms', () => {
    // A real next note falls outside the window.
    const follower = new ScoreFollower(steps());
    follower.noteOn(62, 1000);
    expect(follower.noteOn(60, 1316)).toMatchObject({ kind: 'advance', to: 2 });
  });

  it('calls his slowest logged graze (59 ms) a graze, and 100 ms a real note', () => {
    // 11/4 bar 33: D5 then C5 at velocity 9, 59 ms later. A 16th at 150 bpm is 100 ms.
    const follower = new ScoreFollower(steps());
    follower.noteOn(62, 1000);
    expect(follower.noteOn(60, 1059)).toMatchObject({ kind: 'stray', reason: 'graze' });
    expect(follower.noteOn(60, 1100)).toMatchObject({ kind: 'advance', to: 2 });
  });

  it('treats a wrong key within 20 ms as a graze without resetting the step', () => {
    // The stray leaves the next step ready to play.
    const follower = new ScoreFollower(steps());
    follower.noteOn(62, 1000);
    expect(follower.noteOn(63, 1020)).toMatchObject({ kind: 'stray', reason: 'graze' });
    expect(follower.index).toBe(1);
    expect([...follower.satisfied]).toEqual([]);
    expect(follower.noteOn(60, 1400)).toMatchObject({ kind: 'advance', from: 1, to: 2 });
  });

  it('allows the old 25 ms behavior when grazeMs is zero', () => {
    // Zero disables the graze window.
    const follower = new ScoreFollower(steps());
    follower.grazeMs = 0;
    follower.noteOn(62, 1000);
    expect(follower.noteOn(60, 1025)).toMatchObject({ kind: 'advance', to: 2 });
  });

  it('credits closely spaced notes within a chord', () => {
    // The window starts only when the chord finishes.
    const follower = new ScoreFollower([
      { notes: [60, 64, 67], beat: 0, measure: 1 },
      { notes: [62], beat: 1, measure: 1 },
    ]);
    expect(follower.noteOn(60, 1000)).toMatchObject({ kind: 'partial', remaining: [64, 67] });
    expect(follower.noteOn(64, 1010)).toMatchObject({ kind: 'partial', remaining: [67] });
    expect(follower.noteOn(67, 1020)).toMatchObject({ kind: 'advance', from: 0, to: 1 });
  });

  it('ignores a harmless re-strike of the step just finished', () => {
    // A repeated D is harmless while C is expected.
    const follower = new ScoreFollower(steps([62, 60]));
    expect(follower.noteOn(62, 1000)).toMatchObject({ kind: 'advance', to: 1 });
    expect(follower.noteOn(62, 1020)).toMatchObject({ kind: 'ignored' });
    expect(follower.index).toBe(1);
    expect([...follower.satisfied]).toEqual([]);
  });

  it('rejects soft notes only when a velocity floor is enabled', () => {
    // Soft strikes receive no credit; zero leaves filtering off.
    const follower = new ScoreFollower(steps());
    follower.minVelocity = 20;
    expect(follower.noteOn(62, 1000, new Set(), 15)).toMatchObject({
      kind: 'stray', reason: 'soft',
    });
    expect(follower.index).toBe(0);
    expect([...follower.satisfied]).toEqual([]);
    expect(follower.noteOn(62, 1500, new Set(), 40)).toMatchObject({ kind: 'advance', to: 1 });
    const unfiltered = new ScoreFollower(steps());
    unfiltered.minVelocity = 0;
    expect(unfiltered.noteOn(62, 1000, new Set(), 5)).toMatchObject({ kind: 'advance', to: 1 });
  });

  it('preserves the graze window across a loop wrap', () => {
    // Wrapping starts lap two but keeps the finish timestamp.
    const follower = new ScoreFollower(steps([62, 60, 64]));
    follower.setRange(0, 1);
    expect(follower.noteOn(62, 1000)).toMatchObject({ kind: 'advance', to: 1 });
    expect(follower.noteOn(60, 1400)).toMatchObject({ kind: 'loop', to: 0, lap: 2 });
    expect(follower.noteOn(62, 1420)).toMatchObject({ kind: 'stray', reason: 'graze' });
    expect(follower.index).toBe(0);
    expect([...follower.satisfied]).toEqual([]);
    expect(follower.lap).toBe(2);
    expect(follower.noteOn(62, 1800)).toMatchObject({ kind: 'advance', to: 1 });
    expect(follower.lap).toBe(2);
  });

  it('a graze never confirms a held carry, so it cannot finish a step or a lap', () => {
    // Codex review: [[60,64],[60]] looped, 60 held; a graze at +25 ms must not settle the carry.
    const follower = new ScoreFollower([
      { notes: [60, 64], beat: 0, measure: 1 },
      { notes: [60], beat: 1, measure: 1 },
    ]);
    follower.setRange(0, 1);
    follower.noteOn(60, 1000);
    expect(follower.noteOn(64, 1010, new Set([60]))).toMatchObject({ kind: 'advance', to: 1 });
    expect(follower.noteOn(61, 1035, new Set([60]))).toMatchObject({ kind: 'stray', reason: 'graze' });
    expect(follower.index).toBe(1);
    expect(follower.lap).toBe(1);
  });

  it('the same key again inside the window is a double trigger: ignored, not a stray', () => {
    // A written repeat (C C) can't be re-struck in 80 ms; his shortest hold was 157 ms.
    const follower = new ScoreFollower(steps([60, 60, 64]));
    follower.noteOn(60, 1000);
    expect(follower.noteOn(60, 1030)).toMatchObject({ kind: 'ignored' });
    expect(follower.noteOn(60, 1400)).toMatchObject({ kind: 'advance', to: 2 });
  });

  it('clears the graze window on seek', () => {
    // Seeking allows an immediate strike at the destination.
    const follower = new ScoreFollower(steps());
    expect(follower.noteOn(62, 1000)).toMatchObject({ kind: 'advance', to: 1 });
    follower.seek(1);
    expect(follower.noteOn(60, 1010)).toMatchObject({ kind: 'advance', from: 1, to: 2 });
  });
});
