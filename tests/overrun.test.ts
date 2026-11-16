// #5945 — a 1.5 s grace after a loop's end: playing on past it thuds but isn't a failure.

import { describe, expect, it } from 'vitest';
import type { ScoreStep } from '../src/renderer/engine/ScoreFollower';
import { closeLap, keepNote, startKeep, lapEndMs } from '../src/renderer/engine/KeepGoing';
import { GRACE_MS, overrunNote, startOverrun } from '../src/renderer/engine/Overrun';

// C D E F | G A (chord B+D) | C: loop is steps 0-3, the piece carries on G A [B D] C.
const steps: ScoreStep[] = [60, 62, 64, 65, 67, 69].map((n, i) => ({ notes: [n], beat: i, measure: i < 4 ? 1 : 2 }));
steps.push({ notes: [71, 74], beat: 6, measure: 2 }, { notes: [72], beat: 7, measure: 2 });

describe('overrun grace', () => {
  it('forgives the note the piece carries on with, inside the window only', () => {
    const o = startOverrun(steps, 3, 10_000)!;
    expect(overrunNote(o, steps, 67, 10_000 + GRACE_MS)).toBe(true); // G, just inside
    expect(overrunNote(startOverrun(steps, 3, 10_000), steps, 67, 10_000 + GRACE_MS + 1)).toBe(false);
    expect(overrunNote(startOverrun(steps, 3, 10_000), steps, 67, 9_999)).toBe(false); // before the wrap
  });

  it('a note that is wrong for the next step stays wrong', () => {
    const o = startOverrun(steps, 3, 0);
    expect(overrunNote(o, steps, 61, 200)).toBe(false); // not G
    expect(overrunNote(o, steps, 69, 200)).toBe(false); // A is two steps on, not next
  });

  it('follows him on through the following steps and chords', () => {
    const o = startOverrun(steps, 3, 0);
    expect(overrunNote(o, steps, 67, 100)).toBe(true); // G
    expect(overrunNote(o, steps, 67, 150)).toBe(false); // G again: no longer asked for
    expect(overrunNote(o, steps, 69, 300)).toBe(true); // A
    expect(overrunNote(o, steps, 74, 400)).toBe(true); // chord, either order
    expect(overrunNote(o, steps, 71, 450)).toBe(true);
    expect(overrunNote(o, steps, 72, 600)).toBe(true); // C
    expect(overrunNote(o, steps, 60, 700)).toBe(false); // piece over
  });

  it('has nothing to forgive when the loop is the end of the piece, or no window is open', () => {
    expect(startOverrun(steps, steps.length - 1, 0)).toBeNull();
    expect(overrunNote(null, steps, 67, 0)).toBe(false);
  });
});

describe('overrun in Keep going', () => {
  const loop = () => startKeep(0, 3, 60, 0); // 1 s a beat; lap ends at 4000

  it('closing a lap opens the grace; a note carrying on is overrun, not wrong', () => {
    const run = loop();
    closeLap(run, steps, false);
    expect(run.startMs).toBe(4000);
    expect(keepNote(run, steps, 67, 4200)).toBe('overrun'); // G past the loop, new lap's C is under the cursor
    expect(run.wrong).toBe(0);
    expect(run.wrongBars.size).toBe(0);
  });

  it('is wrong outside the window or for the wrong note', () => {
    const run = loop();
    closeLap(run, steps, false);
    expect(keepNote(run, steps, 61, 4200)).toBe('wrong'); // not what the piece does next
    expect(keepNote(run, steps, 67, 4000 + GRACE_MS + 100)).toBe('wrong'); // too late
    expect(run.wrong).toBe(2);
  });

  it('the new lap\'s own first note is still a hit', () => {
    const run = loop();
    closeLap(run, steps, false);
    expect(keepNote(run, steps, 60, 4050)).toBe('hit');
    expect(lapEndMs(run, steps)).toBe(8000);
  });
});
