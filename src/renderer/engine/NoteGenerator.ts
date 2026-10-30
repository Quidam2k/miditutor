import { Pitch, Clef } from '../types/music';
import { midiNumberToPitch, isWhiteKey, IntervalSpec, JP_INTERVALS, spellIntervalAbove } from './MusicTheory';

/** Where the interval drill's two notes sit on each staff (no ledger-line marathons). */
export const INTERVAL_RANGE: Record<Clef, [number, number]> = { treble: [60, 81], bass: [40, 62] };

/**
 * One of JP's assigned intervals above a natural root, picked evenly from the set and never
 * the same interval twice in a row. Treble and bass are practised separately, as he set it.
 */
export function generateJpInterval(clef: Clef, avoid?: string): { interval: IntervalSpec; notes: [Pitch, Pitch] } {
  const [low, high] = INTERVAL_RANGE[clef];
  const choices = JP_INTERVALS.filter((i) => i.short !== avoid);
  const interval = choices[Math.floor(Math.random() * choices.length)];
  const roots: Pitch[] = [];
  for (let midi = low; midi + interval.semitones <= high; midi++) {
    if (isWhiteKey(midi)) roots.push(midiNumberToPitch(midi));
  }
  const root = roots[Math.floor(Math.random() * roots.length)];
  return { interval, notes: [root, spellIntervalAbove(root, interval)] };
}
