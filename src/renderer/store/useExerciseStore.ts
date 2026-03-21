import { create } from 'zustand';
import { Exercise, ExerciseResult, ExercisePhase } from '../types/exercise';

interface ExerciseState {
  currentExercise: Exercise | null;
  lastResult: ExerciseResult | null;
  phase: ExercisePhase;
  presentedAt: number | null; // timestamp when exercise was shown
  playedNotes: number[]; // MIDI numbers collected during input

  setExercise: (exercise: Exercise) => void;
  setResult: (result: ExerciseResult) => void;
  setPhase: (phase: ExercisePhase) => void;
  addPlayedNote: (midiNumber: number) => void;
  clearPlayedNotes: () => void;
  reset: () => void;
}

export const useExerciseStore = create<ExerciseState>((set) => ({
  currentExercise: null,
  lastResult: null,
  phase: 'idle',
  presentedAt: null,
  playedNotes: [],

  setExercise: (exercise) =>
    set({ currentExercise: exercise, phase: 'presenting', presentedAt: Date.now(), playedNotes: [], lastResult: null }),
  setResult: (result) => set({ lastResult: result, phase: 'feedback' }),
  setPhase: (phase) => set({ phase }),
  addPlayedNote: (midiNumber) =>
    set((state) => ({ playedNotes: [...state.playedNotes, midiNumber] })),
  clearPlayedNotes: () => set({ playedNotes: [] }),
  reset: () =>
    set({ currentExercise: null, lastResult: null, phase: 'idle', presentedAt: null, playedNotes: [] }),
}));
