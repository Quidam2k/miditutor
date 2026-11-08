// #5652 K — Keep going: fixed-tempo grading, early hits, lap tally, step-up.

import { describe, expect, it } from 'vitest';
import type { ScoreStep } from '../src/renderer/engine/ScoreFollower';
import { closeLap, countInBeats, keepNote, lapEndMs, lapLabel, startKeep, stepAt } from '../src/renderer/engine/KeepGoing';

// Two bars of 4/4 quarter notes: C D E F | G A B C, plus a chord on beat 8.
const steps: ScoreStep[] = [60, 62, 64, 65, 67, 69, 71].map((n, i) => ({ notes: [n], beat: i, measure: i < 4 ? 1 : 2 }));
steps.push({ notes: [72, 76], beat: 7, measure: 2 });

// At 60 bpm a beat is 1000 ms; the first step's beat is at t = 1000.
const run0 = () => startKeep(0, steps.length - 1, 60, 1000);

describe('keep going', () => {
  it('moves the cursor by the clock, not by his notes', () => {
    const run = run0();
    expect(stepAt(run, steps, 999)).toBe(-1);
    expect(stepAt(run, steps, 1000)).toBe(0);
    expect(stepAt(run, steps, 3500)).toBe(2);
    expect(stepAt(run, steps, 99999)).toBe(7);
    expect(lapEndMs(run, steps)).toBe(9000);
  });

  it('counts the bar of the first step for the count-in', () => {
    expect(countInBeats(steps, 0)).toBe(4);
    expect(countInBeats(steps, 4)).toBe(4);
    const waltz: ScoreStep[] = [0, 1, 2, 3].map((b) => ({ notes: [60], beat: b, measure: b < 3 ? 1 : 2 }));
    expect(countInBeats(waltz, 0)).toBe(3);
  });

  it('takes a hit in its step, an early hit just before, and calls the rest wrong', () => {
    const run = run0();
    expect(keepNote(run, steps, 60, 500)).toBe('ignored'); // count-in
    expect(keepNote(run, steps, 60, 950)).toBe('hit'); // 50 ms early for step 0
    expect(keepNote(run, steps, 60, 1100)).toBe('ignored'); // repeat of a hit
    expect(keepNote(run, steps, 62, 2300)).toBe('hit');
    expect(keepNote(run, steps, 61, 2400)).toBe('wrong');
    expect(keepNote(run, steps, 64, 2950)).toBe('hit'); // early for step 2
    expect(keepNote(run, steps, 65, 3500)).toBe('wrong'); // F while E is under the cursor
  });

  it('tallies a lap, names the worst bars and steps up after a clean lap', () => {
    const run = run0();
    keepNote(run, steps, 60, 1000);
    keepNote(run, steps, 62, 2000);
    keepNote(run, steps, 61, 2100);
    const lap = closeLap(run, steps, true);
    expect(lap).toMatchObject({ lap: 1, bpm: 60, notes: 9, hit: 2, missed: 7, wrong: 1, nextBpm: 60 });
    expect(lap.worstBars[0]).toEqual({ bar: 2, missed: 5, wrong: 0 });
    expect(lapLabel(lap)).toContain('2 of 9 notes, 1 wrong');
    // The next lap starts where this one ended.
    expect(run.startMs).toBe(9000);
    expect(run.lap).toBe(2);

    for (const [i, s] of steps.entries()) for (const n of s.notes) keepNote(run, steps, n, 9000 + i * 1000 + 10);
    const clean = closeLap(run, steps, true);
    expect(clean).toMatchObject({ hit: 9, wrong: 0, nextBpm: 64 });
    expect(lapLabel(clean)).toContain('Every note!');
    expect(run.bpm).toBe(64);
  });

  it('never steps past the target tempo, and stays put with step-up off', () => {
    const play = (run: ReturnType<typeof run0>) => {
      const b = 60000 / run.bpm;
      for (const [i, s] of steps.entries()) for (const n of s.notes) keepNote(run, steps, n, run.startMs + i * b + 5);
    };
    const run = run0();
    play(run);
    expect(closeLap(run, steps, true, 62).nextBpm).toBe(62);
    play(run);
    expect(closeLap(run, steps, true, 62).nextBpm).toBe(62);
    play(run);
    expect(closeLap(run, steps, false).nextBpm).toBe(62);
  });
});
