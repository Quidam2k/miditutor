import { Exercise, ExerciseType, ExerciseResult } from '../types/exercise';
import { Clef } from '../types/music';
import { IntervalSpec } from './MusicTheory';
import { DifficultyManager } from './DifficultyManager';
import { generateJpInterval } from './NoteGenerator';
import { evaluate } from './Evaluator';

let exerciseCounter = 0;

export class ExerciseEngine {
  private difficulty: DifficultyManager;
  private clef: Clef;
  private exerciseType: ExerciseType;
  private lastInterval?: string;

  constructor(clef: Clef = 'treble', exerciseType: ExerciseType = 'interval') {
    this.difficulty = new DifficultyManager();
    this.clef = clef;
    this.exerciseType = exerciseType;
  }

  setClef(clef: Clef): void {
    this.clef = clef;
  }

  setExerciseType(type: ExerciseType): void {
    this.exerciseType = type;
  }

  getDifficulty(): DifficultyManager {
    return this.difficulty;
  }

  /** `chosen`: the interval to ask (#5652 J weights it); else one at random. */
  generateExercise(chosen?: IntervalSpec): Exercise {
    const id = `ex-${++exerciseCounter}`;
    // JP's assigned set (m2..P8) rather than random semitone pairs, which were mostly half steps.
    const { interval, notes: [first, second] } = generateJpInterval(this.clef, this.lastInterval, chosen);
    this.lastInterval = interval.short;
    return {
      id,
      type: 'interval',
      prompt: [first, second],
      expectedMidiNumbers: [first.midiNumber, second.midiNumber],
      clef: this.clef,
      intervalName: interval.name,
      intervalShort: interval.short,
    };
  }

  evaluate(exercise: Exercise, playedMidiNumbers: number[], responseTimeMs: number): ExerciseResult {
    const result = evaluate(exercise, playedMidiNumbers, responseTimeMs);

    // Record mastery for each expected note
    for (const midi of exercise.expectedMidiNumbers) {
      this.difficulty.recordAttempt(midi, result.correct);
    }

    return result;
  }

  reset(): void {
    this.difficulty.reset();
    this.lastInterval = undefined;
    exerciseCounter = 0;
  }
}
