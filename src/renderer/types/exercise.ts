import { Clef, Pitch } from './music';

export type ExerciseType = 'note-identification' | 'interval';

export type ExercisePhase = 'idle' | 'presenting' | 'awaiting-input' | 'feedback';

export interface Exercise {
  id: string;
  type: ExerciseType;
  prompt: Pitch[];
  expectedMidiNumbers: number[];
  clef: Clef;
}

export interface ExerciseResult {
  correct: boolean;
  expected: number[];
  played: number[];
  responseTimeMs: number;
}
