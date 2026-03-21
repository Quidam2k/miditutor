import { Pitch, Clef } from '../types/music';
import { midiNumberToPitch, isWhiteKey } from './MusicTheory';

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

/**
 * Generate a pair of notes for interval exercises
 */
export function generateInterval(
  options: NoteGeneratorOptions,
  minSemitones: number = 1,
  maxSemitones: number = 12,
): [Pitch, Pitch] {
  const first = generateRandomNote(options);

  // Generate second note within interval constraints
  const possibleIntervals: number[] = [];
  for (let i = minSemitones; i <= maxSemitones; i++) {
    const up = first.midiNumber + i;
    const down = first.midiNumber - i;
    if (up >= options.rangeLow && up <= options.rangeHigh) possibleIntervals.push(up);
    if (down >= options.rangeLow && down <= options.rangeHigh) possibleIntervals.push(down);
  }

  if (possibleIntervals.length === 0) {
    // Fallback: just use the note above
    return [first, midiNumberToPitch(Math.min(first.midiNumber + 2, options.rangeHigh))];
  }

  const secondMidi = possibleIntervals[Math.floor(Math.random() * possibleIntervals.length)];
  const second = midiNumberToPitch(secondMidi);

  // Return in ascending order
  if (first.midiNumber <= second.midiNumber) {
    return [first, second];
  }
  return [second, first];
}
