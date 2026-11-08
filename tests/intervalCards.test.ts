import { describe, it, expect } from 'vitest';
import { HARD_MIN_TRIES, hardestIntervals, intervalId, pickInterval } from '../src/renderer/engine/IntervalCards';
import { NoteStat, NoteStats } from '../src/renderer/engine/NoteTrainer';
import { JP_INTERVALS } from '../src/renderer/engine/MusicTheory';
import { generateJpInterval } from '../src/renderer/engine/NoteGenerator';
import { ExerciseEngine } from '../src/renderer/engine/ExerciseEngine';

const stat = (hits: number, attempts: number, avgMs: number | null, recent: boolean[]): NoteStat => ({ attempts, hits, avgMs, recent });
const good = stat(6, 6, 1500, [true, true, true, true, true, true]);

describe('interval cards', () => {
  it('ids are per clef', () => {
    expect(intervalId('bass', 'm3')).toBe('bass:m3');
  });

  it('brings a missed, slow interval back far more often, and never the one just asked', () => {
    const stats: NoteStats = Object.fromEntries(JP_INTERVALS.map((i) => [intervalId('treble', i.short), good]));
    stats['treble:m6'] = stat(2, 6, 6000, [false, true, false, true, false, false]);
    let m6 = 0;
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 2000; k++) if (pickInterval('treble', stats, undefined, rand).short === 'm6') m6++;
    expect(m6 / 2000).toBeGreaterThan(0.5);
    for (let k = 0; k < 200; k++) expect(pickInterval('treble', stats, 'm6', rand).short).not.toBe('m6');
    // The bass record doesn't steer treble picks.
    expect(pickInterval('bass', stats, undefined, () => 0).short).toBe('m2');
  });

  it('lists the hardest intervals: lowest recent hit rate, then slowest, with enough tries', () => {
    const stats: NoteStats = {
      'treble:P5': good,
      'treble:M7': stat(3, 5, 4000, [true, false, true, false, true]),
      'treble:m2': stat(4, 5, 5000, [true, true, false, true, true]),
      'treble:M2': stat(4, 5, 2000, [true, true, false, true, true]),
      'treble:A4': stat(0, HARD_MIN_TRIES - 1, null, [false, false]),
      'bass:m3': stat(0, 5, null, [false, false, false, false, false]),
    };
    const h = hardestIntervals('treble', stats);
    expect(h.map((x) => x.short)).toEqual(['M7', 'm2', 'M2']);
    expect(h[0]).toEqual({ short: 'M7', name: 'Major 7th', hitRate: 0.6, avgMs: 4000, tries: 5 });
    expect(hardestIntervals('bass', stats).map((x) => x.short)).toEqual(['m3']);
  });

  it('asks the chosen interval', () => {
    const tritone = JP_INTERVALS.find((i) => i.short === 'd5')!;
    for (let k = 0; k < 20; k++) {
      const { interval, notes } = generateJpInterval('bass', 'd5', tritone);
      expect(interval.short).toBe('d5');
      expect(notes[1].midiNumber - notes[0].midiNumber).toBe(6);
    }
    const ex = new ExerciseEngine('treble').generateExercise(tritone);
    expect(ex.intervalShort).toBe('d5');
    expect(ex.intervalName).toBe('Diminished 5th');
  });
});
