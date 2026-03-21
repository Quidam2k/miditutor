import { Exercise, ExerciseType, ExerciseResult } from '../types/exercise';
import { Clef } from '../types/music';
import { DifficultyManager } from './DifficultyManager';
import { generateRandomNote, generateInterval } from './NoteGenerator';
import { evaluate } from './Evaluator';

let exerciseCounter = 0;

export class ExerciseEngine {
  private difficulty: DifficultyManager;
  private clef: Clef;
  private exerciseType: ExerciseType;
  private lastMidiNumber?: number;

  constructor(clef: Clef = 'treble', exerciseType: ExerciseType = 'note-identification') {
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

  generateExercise(): Exercise {
    const id = `ex-${++exerciseCounter}`;
    const options = {
      rangeLow: this.difficulty.rangeLow,
      rangeHigh: this.difficulty.rangeHigh,
      includeAccidentals: this.difficulty.accidentals,
      clef: this.clef,
      avoidRepeat: this.lastMidiNumber,
    };

    if (this.exerciseType === 'note-identification') {
      const pitch = generateRandomNote(options);
      this.lastMidiNumber = pitch.midiNumber;
      return {
        id,
        type: 'note-identification',
        prompt: [pitch],
        expectedMidiNumbers: [pitch.midiNumber],
        clef: this.clef,
      };
    } else {
      const [first, second] = generateInterval(options);
      this.lastMidiNumber = second.midiNumber;
      return {
        id,
        type: 'interval',
        prompt: [first, second],
        expectedMidiNumbers: [first.midiNumber, second.midiNumber],
        clef: this.clef,
      };
    }
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
    this.lastMidiNumber = undefined;
    exerciseCounter = 0;
  }
}
