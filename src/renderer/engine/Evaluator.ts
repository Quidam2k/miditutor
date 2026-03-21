import { Exercise, ExerciseResult } from '../types/exercise';

/**
 * Evaluate whether the played notes match the expected notes.
 * For note-identification: single note match (enharmonic equivalent = same MIDI number)
 * For intervals: both notes must match in any order
 */
export function evaluate(
  exercise: Exercise,
  playedMidiNumbers: number[],
  responseTimeMs: number,
): ExerciseResult {
  const expected = exercise.expectedMidiNumbers;

  let correct: boolean;
  if (exercise.type === 'note-identification') {
    // Single note: just check if the played note matches
    correct = playedMidiNumbers.length === 1 && playedMidiNumbers[0] === expected[0];
  } else {
    // Interval: both notes must be played, order doesn't matter
    correct =
      playedMidiNumbers.length === expected.length &&
      expected.every((n) => playedMidiNumbers.includes(n));
  }

  return {
    correct,
    expected,
    played: playedMidiNumbers,
    responseTimeMs,
  };
}
