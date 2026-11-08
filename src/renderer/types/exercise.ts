import { Clef, Pitch } from './music';

export type ExerciseType = 'note-identification' | 'interval' | 'homework';

export type ExercisePhase = 'idle' | 'presenting' | 'awaiting-input' | 'feedback';

export interface Exercise {
  id: string;
  type: ExerciseType;
  prompt: Pitch[];
  expectedMidiNumbers: number[];
  clef: Clef;
  /** Interval drill: the interval asked for, e.g. "Major 3rd". */
  intervalName?: string;
  /** JP's short name for it, e.g. "m3" (#5652 J). */
  intervalShort?: string;
}

export interface ExerciseResult {
  correct: boolean;
  expected: number[];
  played: number[];
  responseTimeMs: number;
}
