import { describe, it, expect } from 'vitest';
import { ScoreFollower } from '../src/renderer/engine/ScoreFollower';
import type { FollowResult, ScoreStep } from '../src/renderer/engine/ScoreFollower';

// #5633: Sorcerer's Apprentice bars 31-32 as his score writes them. The left hand's B2-Eb3-G3
// is tied into bar 32 (rings at its first step), then rests under the F4, then G3-Eb3-Bb3.
const RING = [47, 51, 55];
const steps: ScoreStep[] = [
  { notes: [67, 47, 51, 55], beat: 0, measure: 31 },
  { notes: [70], beat: 0.5, measure: 31, ringing: RING },
  { notes: [68], beat: 1, measure: 31, ringing: RING },
  { notes: [67], beat: 1.5, measure: 32, ringing: RING },
  { notes: [65], beat: 2, measure: 32, ringing: [] },
  { notes: [63, 55, 51, 58], beat: 2.5, measure: 32 },
];

/** Loop bar 32 as he did (it starts on the tied chord), and play `strikes` = [note, ms, held...]. */
function play(strikes: [number, number, number[]][]): FollowResult['kind'][] {
  const f = new ScoreFollower(steps);
  f.setRange(3, 5);
  return strikes.map(([note, ms, held]) => f.noteOn(note, ms, new Set(held)).kind);
}

describe('holding through a rest (#5633)', () => {
  it('his 12:06:28 lap: the tied chord struck with the G4 and held right through the rest is clean', () => {
    const kinds = play([
      [51, 1000, []],
      [55, 1010, [51]],
      [67, 1015, [51, 55]],
      [47, 1022, [51, 55, 67]], // B2 7 ms after the melody note: inside the graze window, still fine
      [65, 1700, [51, 55, 67, 47]], // the F4 over the left hand's rest, chord still held
      [58, 3300, [47]], // B2 still down when the next chord starts
      [55, 3317, [47, 58]],
      [63, 3320, [47, 58, 55]],
      [51, 3324, [47, 58, 55, 63]],
    ]);
    expect(kinds).not.toContain('wrong');
    expect(kinds).not.toContain('stray');
    expect(kinds.slice(-1)).toEqual(['loop']);
  });

  it('a key that is not written, struck beside the tied chord, still counts against him', () => {
    // His 12:06:56 lap: C3 where the score has B2, 8 ms after the G4.
    expect(play([[55, 1000, []], [51, 1011, [55]], [67, 1018, [55, 51]], [48, 1026, [55, 51, 67]]]))
      .toEqual(['ignored', 'ignored', 'advance', 'stray']);
    // And struck on its own over the rest, it is a wrong note.
    expect(play([[67, 1000, []], [48, 1400, [67]]])).toEqual(['advance', 'wrong']);
  });
});
