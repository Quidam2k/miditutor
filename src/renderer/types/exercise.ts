import { Clef, Pitch } from './music';

export type ExerciseType = 'note-identification' | 'interval';

export type ExercisePhase = 'idle' | 'presenting' | 'awaiting-input' | 'feedback';

export interface Exercise {
  id: string;
  type: ExerciseType;
  prompt: Pitch[];
  expectedMidiNumbers: number[];
  clef: Clef;
  /** Interval drill: the interval asked for, e.g. "Major 3rd". */
  intervalName?: string;
}

export interface ExerciseResult {
  correct: boolean;
  expected: number[];
  played: number[];
  responseTimeMs: number;
}
