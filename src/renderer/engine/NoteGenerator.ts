import { Pitch, Clef } from '../types/music';
import { midiNumberToPitch, isWhiteKey, IntervalSpec, JP_INTERVALS, spellIntervalAbove } from './MusicTheory';

export interface NoteGeneratorOptions {
  rangeLow: number;
  rangeHigh: number;
  includeAccidentals: boolean;
  clef: Clef;
  avoidRepeat?: number; // MIDI number to avoid repeating
}

export function generateRandomNote(options: NoteGeneratorOptions): Pitch {
  const { rangeLow, rangeHigh, includeAccidentals, avoidRepeat } = options;

  const candidates: number[] = [];
  for (let midi = rangeLow; midi <= rangeHigh; midi++) {
    if (!includeAccidentals && !isWhiteKey(midi)) continue;
    if (midi === avoidRepeat) continue;
    candidates.push(midi);
  }

  if (candidates.length === 0) {
    // Fallback: just return middle C
    return midiNumberToPitch(60);
  }

  const chosen = candidates[Math.floor(Math.random() * candidates.length)];
  return midiNumberToPitch(chosen);
}

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
