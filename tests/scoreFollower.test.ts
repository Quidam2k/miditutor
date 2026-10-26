import { describe, it, expect } from 'vitest';
import { ScoreFollower } from '../src/renderer/engine/ScoreFollower';
import type { ScoreStep } from '../src/renderer/engine/ScoreFollower';

function makeSteps(notes: number[][]): ScoreStep[] {
  return notes.map((stepNotes, beat) => ({
    notes: stepNotes,
    beat,
    measure: 1
  }));
}

describe('ScoreFollower without a range', () => {
  it('advances through playable steps and completes at the end', () => {
    const follower = new ScoreFollower(makeSteps([[60], [], [62]]));

    expect(follower.range).toBeNull();
    expect(follower.lap).toBe(1);
    expect(follower.index).toBe(0);
    expect(follower.expected).toEqual([60]);
    expect(follower.noteOn(60, 0)).toEqual({
      kind: 'advance',
      from: 0,
      to: 2
    });
    expect(follower.noteOn(62, 1200)).toEqual({
      kind: 'complete',
      from: 2
    });
    expect(follower.finished).toBe(true);
    expect(follower.expected).toEqual([]);
    expect(follower.noteOn(62, 1800)).toEqual({ kind: 'ignored' });
  });

  it('tracks partial chords, ignores repeats, and rejects wrong notes', () => {
    const follower = new ScoreFollower(makeSteps([[67, 60, 64, 60], [62]]));

    expect(follower.expected).toEqual([67, 60, 64]);
    expect(follower.noteOn(60, 0)).toEqual({
      kind: 'partial',
      index: 0,
      remaining: [64, 67]
    });
    expect([...follower.satisfied]).toEqual([60]);
    expect(follower.noteOn(60, 100)).toEqual({ kind: 'ignored' });
    expect(follower.noteOn(61, 200)).toEqual({
      kind: 'wrong',
      index: 0,
      played: 61,
      expected: [67, 60, 64]
    });
    expect([...follower.satisfied]).toEqual([60]);
    expect(follower.noteOn(67, 300)).toEqual({
      kind: 'partial',
      index: 0,
      remaining: [64]
    });
    expect(follower.noteOn(64, 400)).toEqual({
      kind: 'advance',
      from: 0,
      to: 1
    });
    expect(follower.satisfied.size).toBe(0);
  });

  it('estimates approximately 100 bpm for quarter notes 600 ms apart', () => {
    const follower = new ScoreFollower(makeSteps([[60], [62], [64], [65]]));

    expect(follower.paceBpm).toBeNull();
    follower.noteOn(60, 0);
    expect(follower.paceBpm).toBeNull();
    follower.noteOn(62, 600);
    follower.noteOn(64, 1200);
    follower.noteOn(65, 1800);

    expect(follower.paceBpm).toBe(100);
  });

  it('preserves seek normalization and clears matching and pace state', () => {
    const follower = new ScoreFollower(makeSteps([[60, 64], [], [62]]));

    follower.noteOn(60, 0);
    follower.seek(0);
    expect(follower.satisfied.size).toBe(0);

    follower.seek(1.9);
    expect(follower.index).toBe(2);

    follower.seek(99);
    expect(follower.finished).toBe(true);

    follower.seek(-10);
    expect(follower.index).toBe(0);

    follower.seek(Number.NaN);
    expect(follower.index).toBe(0);

    follower.noteOn(60, 0);
    follower.noteOn(64, 0);
    follower.noteOn(62, 1200);
    expect(follower.paceBpm).toBe(100);

    follower.reset();
    expect(follower.index).toBe(0);
    expect(follower.satisfied.size).toBe(0);
    expect(follower.paceBpm).toBeNull();
  });

  it('ignores notes for empty and entirely unplayable scores', () => {
    for (const steps of [[], makeSteps([[], []])]) {
      const follower = new ScoreFollower(steps);

      expect(follower.finished).toBe(true);
      expect(follower.noteOn(60, 0)).toEqual({ kind: 'ignored' });
    }
  });
});

describe('ScoreFollower loop ranges', () => {
  it('wraps an inclusive range with laps 2 and 3 and never completes', () => {
    const follower = new ScoreFollower(makeSteps([[60], [62], [64], [65]]));

    follower.setRange(1, 2);
    expect(follower.range).toEqual({ first: 1, last: 2 });
    expect(follower.index).toBe(1);
    expect(follower.lap).toBe(1);

    expect(follower.noteOn(62, 0)).toEqual({
      kind: 'advance',
      from: 1,
      to: 2
    });
    expect(follower.noteOn(64, 600)).toEqual({
      kind: 'loop',
      from: 2,
      to: 1,
      lap: 2
    });
    expect(follower.finished).toBe(false);
    expect(follower.satisfied.size).toBe(0);

    expect(follower.noteOn(62, 1200)).toEqual({
      kind: 'advance',
      from: 1,
      to: 2
    });
    expect(follower.noteOn(64, 1800)).toEqual({
      kind: 'loop',
      from: 2,
      to: 1,
      lap: 3
    });
    expect(follower.lap).toBe(3);
    expect(follower.finished).toBe(false);
  });

  it('wraps at the end of the piece instead of returning complete', () => {
    const follower = new ScoreFollower(makeSteps([[60], [62]]));

    follower.setRange(1, 1);

    expect(follower.noteOn(62, 0)).toEqual({
      kind: 'loop',
      from: 1,
      to: 1,
      lap: 2
    });
    expect(follower.noteOn(62, 600)).toEqual({
      kind: 'loop',
      from: 1,
      to: 1,
      lap: 3
    });
  });

  it('swaps reversed endpoints and clamps them to valid step indices', () => {
    const follower = new ScoreFollower(makeSteps([[60], [62], [64], [65]]));

    follower.setRange(3, 1);
    expect(follower.range).toEqual({ first: 1, last: 3 });
    expect(follower.index).toBe(1);

    follower.setRange(99, -10);
    expect(follower.range).toEqual({ first: 0, last: 3 });
    expect(follower.index).toBe(0);
  });

  it('seeks past rests and wraps when the next playable step exceeds last', () => {
    const follower = new ScoreFollower(
      makeSteps([[60], [], [62], [], [], [65]])
    );

    follower.setRange(1, 4);
    expect(follower.index).toBe(2);

    expect(follower.noteOn(62, 0)).toEqual({
      kind: 'loop',
      from: 2,
      to: 2,
      lap: 2
    });
  });

  it('stores an unplayable range and ignores notes even after manual seeking', () => {
    const follower = new ScoreFollower(makeSteps([[60], [], [], [65]]));

    follower.setRange(1, 2);
    expect(follower.range).toEqual({ first: 1, last: 2 });
    expect(follower.expected).toEqual([]);
    expect(follower.lap).toBe(1);
    expect(follower.noteOn(65, 0)).toEqual({ kind: 'ignored' });

    follower.seek(0);
    expect(follower.index).toBe(0);
    expect(follower.noteOn(60, 600)).toEqual({ kind: 'ignored' });

    follower.reset();
    expect(follower.expected).toEqual([]);
    expect(follower.lap).toBe(1);
    expect(follower.noteOn(60, 1200)).toEqual({ kind: 'ignored' });
  });

  it('handles a range on an empty score', () => {
    const follower = new ScoreFollower([]);

    follower.setRange(0, 10);

    expect(follower.range).toEqual({ first: 0, last: 0 });
    expect(follower.lap).toBe(1);
    expect(follower.noteOn(60, 0)).toEqual({ kind: 'ignored' });

    follower.reset();
    expect(follower.noteOn(60, 600)).toEqual({ kind: 'ignored' });
  });

  it('clears satisfied notes and resets the lap when setting a range', () => {
    const follower = new ScoreFollower(makeSteps([[60, 64], [62]]));

    follower.noteOn(60, 0);
    follower.setRange(0, 0);

    expect(follower.satisfied.size).toBe(0);
    expect(follower.noteOn(64, 100)).toEqual({
      kind: 'partial',
      index: 0,
      remaining: [60]
    });
    expect(follower.noteOn(60, 200)).toEqual({
      kind: 'loop',
      from: 0,
      to: 0,
      lap: 2
    });

    follower.setRange(1, 1);
    expect(follower.index).toBe(1);
    expect(follower.lap).toBe(1);
    expect(follower.paceBpm).toBeNull();
  });

  it('allows seeking outside the range without removing it', () => {
    const follower = new ScoreFollower(makeSteps([[60], [62], [64], [65]]));

    follower.setRange(1, 2);
    follower.noteOn(62, 0);
    follower.noteOn(64, 600);
    expect(follower.lap).toBe(2);

    follower.seek(0);
    expect(follower.index).toBe(0);
    expect(follower.range).toEqual({ first: 1, last: 2 });
    expect(follower.lap).toBe(2);
    expect(follower.noteOn(60, 1200)).toEqual({
      kind: 'advance',
      from: 0,
      to: 1
    });

    follower.seek(3);
    expect(follower.index).toBe(3);
    expect(follower.range).toEqual({ first: 1, last: 2 });
    expect(follower.noteOn(65, 1800)).toEqual({
      kind: 'loop',
      from: 3,
      to: 1,
      lap: 3
    });

    // Prev/Next inside the loop keeps the lap count; only setRange/reset restart it.
    follower.seek(2);
    expect(follower.index).toBe(2);
    expect(follower.lap).toBe(3);
    expect(follower.paceBpm).toBeNull();
  });

  it('resets to the first playable range step with lap 1', () => {
    const follower = new ScoreFollower(
      makeSteps([[60], [], [62], [64], [65]])
    );

    follower.setRange(1, 3);
    follower.noteOn(62, 0);
    follower.noteOn(64, 600);
    follower.noteOn(62, 1200);
    expect(follower.lap).toBe(2);
    expect(follower.index).toBe(3);

    follower.reset();

    expect(follower.range).toEqual({ first: 1, last: 3 });
    expect(follower.index).toBe(2);
    expect(follower.lap).toBe(1);
    expect(follower.satisfied.size).toBe(0);
    expect(follower.paceBpm).toBeNull();
  });

  it('restores completion at the end after clearing the range', () => {
    const follower = new ScoreFollower(makeSteps([[60], [62], [64]]));

    follower.setRange(1, 2);
    follower.noteOn(62, 0);
    follower.noteOn(64, 600);
    expect(follower.lap).toBe(2);

    follower.clearRange();

    expect(follower.range).toBeNull();
    expect(follower.lap).toBe(1);
    expect(follower.index).toBe(1);
    expect(follower.noteOn(62, 1200)).toEqual({
      kind: 'advance',
      from: 1,
      to: 2
    });
    expect(follower.noteOn(64, 1800)).toEqual({
      kind: 'complete',
      from: 2
    });
    expect(follower.finished).toBe(true);

    follower.reset();
    expect(follower.index).toBe(0);
  });

  it('keeps pace near 100 bpm across multiple wraps and the rolling window', () => {
    const follower = new ScoreFollower(
      makeSteps([[55], [60], [62], [64], [67]])
    );

    follower.setRange(1, 3);

    for (let completion = 0; completion < 15; completion += 1) {
      const midi = [60, 62, 64][completion % 3];
      const result = follower.noteOn(midi, completion * 600);

      expect(result.kind).toBe(completion % 3 === 2 ? 'loop' : 'advance');

      if (completion > 0) {
        expect(follower.paceBpm).not.toBeNull();
        expect(follower.paceBpm!).toBeGreaterThanOrEqual(90);
        expect(follower.paceBpm!).toBeLessThanOrEqual(110);
      }
    }

    expect(follower.lap).toBe(6);
  });

  it('uses a one-beat estimate for a single-step loop', () => {
    const follower = new ScoreFollower(makeSteps([[60]]));

    follower.setRange(0, 0);

    for (let completion = 0; completion < 10; completion += 1) {
      expect(follower.noteOn(60, completion * 600)).toEqual({
        kind: 'loop',
        from: 0,
        to: 0,
        lap: completion + 2
      });

      if (completion > 0) {
        expect(follower.paceBpm).toBe(100);
      }
    }
  });

  it('returns a range copy that cannot mutate the active range', () => {
    const follower = new ScoreFollower(makeSteps([[60], [62], [64]]));

    follower.setRange(1, 2);
    const range = follower.range!;
    range.first = 0;
    range.last = 0;

    expect(follower.range).toEqual({ first: 1, last: 2 });
    follower.reset();
    expect(follower.index).toBe(1);
  });
});

describe('ScoreFollower carry-over and ringing notes (#9480, #9481)', () => {
  it('carries a note still sounding under the pedal into the next step', () => {
    const follower = new ScoreFollower(makeSteps([[53, 60], [53, 64], [65]]));
    follower.noteOn(53, 0);
    // F3 is still ringing (pedal) when C4 completes the step; step 2 only needs E4.
    expect(follower.noteOn(60, 10, new Set([53]))).toEqual({ kind: 'advance', from: 0, to: 1 });
    expect(follower.satisfied.has(53)).toBe(true);
    expect(follower.noteOn(64, 600)).toEqual({ kind: 'advance', from: 1, to: 2 });
  });

  it('still asks for a re-strike when the note is not sounding', () => {
    const follower = new ScoreFollower(makeSteps([[53, 60], [53, 64]]));
    follower.noteOn(53, 0);
    follower.noteOn(60, 10);
    expect(follower.noteOn(64, 600)).toEqual({ kind: 'partial', index: 1, remaining: [53] });
  });

  it('does not call a late re-strike of a carried note wrong', () => {
    const follower = new ScoreFollower(makeSteps([[60], [60], [62]]));
    follower.noteOn(60, 0, new Set([60]));
    // Step 1 was covered by the ringing C4, so the cursor is at step 2.
    expect(follower.index).toBe(2);
    expect(follower.noteOn(60, 300)).toEqual({ kind: 'ignored' });
    expect(follower.noteOn(62, 600)).toEqual({ kind: 'complete', from: 2 });
  });

  it('ignores a re-strike of a written note that is still ringing (tie)', () => {
    const steps: ScoreStep[] = [
      { notes: [65, 72], beat: 0, measure: 1 },
      { notes: [80], beat: 1, measure: 2, ringing: [65, 72] },
    ];
    const follower = new ScoreFollower(steps);
    follower.noteOn(65, 0);
    follower.noteOn(72, 5);
    expect(follower.noteOn(65, 600)).toEqual({ kind: 'ignored' });
    expect(follower.noteOn(70, 650)).toMatchObject({ kind: 'wrong', played: 70 });
  });
});
