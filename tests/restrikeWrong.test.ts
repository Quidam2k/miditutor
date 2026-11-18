import { describe, it, expect } from 'vitest';
import { ScoreFollower, CHORD_WINDOW_MS } from '../src/renderer/engine/ScoreFollower';
import type { ScoreStep } from '../src/renderer/engine/ScoreFollower';

// #6370: Sorcerer's Apprentice bar 30 (steps 93-95 in his 11/16 log): C5 + F3 Ab3, then
// Bb4, then Ab4 + F#3. He played C5 again on beat 2, 18 times, and every one was ignored.
const C5 = 72, F3 = 53, Ab3 = 56, Bb4 = 70, Ab4 = 68, Fs3 = 54;
const bar30 = (): ScoreStep[] => [
  { notes: [C5, F3, Ab3], beat: 0, measure: 30 },
  { notes: [Bb4], beat: 0.5, measure: 30, ringing: [F3, Ab3] },
  { notes: [Ab4, Fs3], beat: 1, measure: 30 },
];

describe('re-striking the note just played (#6370)', () => {
  it('is wrong on the next beat, not silently ignored', () => {
    const f = new ScoreFollower(bar30());
    f.noteOn(C5, 0);
    f.noteOn(F3, 10);
    expect(f.noteOn(Ab3, 20)).toEqual({ kind: 'advance', from: 0, to: 1 });
    expect(f.noteOn(C5, 400)).toMatchObject({ kind: 'wrong', played: C5, expected: [Bb4] });
    expect(f.index).toBe(1);
  });

  it('is still excused as part of the chord burst that finished the step (#9993)', () => {
    const f = new ScoreFollower(bar30());
    f.noteOn(C5, 0);
    f.noteOn(Ab3, 10);
    f.noteOn(F3, 20); // finishes the step
    // C5 again from a re-played chord, just after the finish (past the 80 ms bounce window,
    // inside the chord window): part of that chord, not a wrong note.
    expect(f.noteOn(C5, 20 + CHORD_WINDOW_MS - 10).kind).toBe('ignored');
    expect(f.index).toBe(1);
    // A held LH chord note restruck later is still fine: it is written as ringing.
    expect(f.noteOn(F3, 2000).kind).toBe('ignored');
    expect(f.noteOn(Bb4, 2100)).toEqual({ kind: 'advance', from: 1, to: 2 });
  });
});
