import { describe, it, expect } from 'vitest';
import { soundUntil } from '../src/renderer/engine/ScoreFollower';
import type { ScoreStep } from '../src/renderer/engine/ScoreFollower';

const C = 60, E = 64, G = 67, A = 69, B = 71;

describe('soundUntil: Play it for me holds tied and long notes (#6425)', () => {
  it('holds a chord tied over three bars for one strike, its full length', () => {
    const steps: ScoreStep[] = [
      { notes: [C, E, G], beat: 0, measure: 1 },
      { notes: [], beat: 4, measure: 2, ringing: [C, E, G] },
      { notes: [], beat: 8, measure: 3, ringing: [C, E, G] },
      { notes: [A], beat: 12, measure: 4 },
    ];
    const ends = soundUntil(steps, 0, 3, 13);
    expect([...ends]).toEqual([[C, 12], [E, 12], [G, 12]]);
    // The continuation steps strike nothing.
    expect(soundUntil(steps, 1, 3, 13).size).toBe(0);
  });

  it('holds a long note under moving notes', () => {
    const steps: ScoreStep[] = [
      { notes: [C, G], beat: 0, measure: 1 },
      { notes: [A], beat: 0.5, measure: 1, ringing: [C] },
      { notes: [B], beat: 1, measure: 1, ringing: [C] },
      { notes: [E], beat: 2, measure: 1 },
    ];
    const ends = soundUntil(steps, 0, 3, 3);
    expect(ends.get(C)).toBe(2);
    expect(ends.get(G)).toBe(0.5);
  });

  it('ends a note where the same pitch is struck again', () => {
    const steps: ScoreStep[] = [
      { notes: [C, E], beat: 0, measure: 1 },
      { notes: [C], beat: 1, measure: 1, ringing: [E] },
      { notes: [G], beat: 2, measure: 1 },
    ];
    const ends = soundUntil(steps, 0, 2, 3);
    expect(ends.get(C)).toBe(1);
    expect(ends.get(E)).toBe(2);
  });

  it('cuts a tie at the loop end', () => {
    const steps: ScoreStep[] = [
      { notes: [C], beat: 0, measure: 1 },
      { notes: [], beat: 4, measure: 2, ringing: [C] },
      { notes: [], beat: 8, measure: 3, ringing: [C] },
    ];
    // Loop over steps 0-1 only: the run ends one beat after step 1.
    expect(soundUntil(steps, 0, 1, 5).get(C)).toBe(5);
  });
});
