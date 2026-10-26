import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Clef } from '../types/music';
import { ExerciseType } from '../types/exercise';

interface SettingsState {
  clef: Clef;
  exerciseType: ExerciseType;
  audioEnabled: boolean;
  showNoteNames: boolean;
  /** Score-tab pieces pinned to the top of the list, by displayed title (#9610). */
  favoritePieces: string[];
  /** Interval drill: right answers today toward JP's 10 a day (local date, YYYY-MM-DD). */
  intervalGoal: { day: string; correct: number };

  setClef: (clef: Clef) => void;
  setExerciseType: (type: ExerciseType) => void;
  setAudioEnabled: (enabled: boolean) => void;
  setShowNoteNames: (show: boolean) => void;
  toggleFavoritePiece: (title: string) => void;
  countIntervalCorrect: () => void;
}

/** Today's date on this machine's clock (Pacific on Pinocchio), so the goal resets at local midnight. */
export function localDay(now = new Date()): string {
  return now.toLocaleDateString('en-CA');
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      clef: 'treble',
      exerciseType: 'note-identification',
      // He plays the notes himself; the tutor only sounds when he asks (#5059).
      audioEnabled: false,
      showNoteNames: false,
      favoritePieces: [],
      intervalGoal: { day: '', correct: 0 },

      setClef: (clef) => set({ clef }),
      setExerciseType: (type) => set({ exerciseType: type }),
      setAudioEnabled: (enabled) => set({ audioEnabled: enabled }),
      setShowNoteNames: (show) => set({ showNoteNames: show }),
      toggleFavoritePiece: (title) =>
        set((s) => ({
          favoritePieces: s.favoritePieces.includes(title)
            ? s.favoritePieces.filter((t) => t !== title)
            : [...s.favoritePieces, title],
        })),
      countIntervalCorrect: () =>
        set((s) => {
          const day = localDay();
          return { intervalGoal: { day, correct: (s.intervalGoal.day === day ? s.intervalGoal.correct : 0) + 1 } };
        }),
    }),
    {
      name: 'miditutor-settings',
      // v1 (#5059): Audio now defaults OFF; turn off the ON every earlier install saved.
      version: 1,
      migrate: (persisted, version) => {
        const state = persisted as Partial<SettingsState>;
        return (version < 1 ? { ...state, audioEnabled: false } : state) as SettingsState;
      },
    },
  ),
);
