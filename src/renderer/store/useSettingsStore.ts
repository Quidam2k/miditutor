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

  setClef: (clef: Clef) => void;
  setExerciseType: (type: ExerciseType) => void;
  setAudioEnabled: (enabled: boolean) => void;
  setShowNoteNames: (show: boolean) => void;
  toggleFavoritePiece: (title: string) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      clef: 'treble',
      exerciseType: 'note-identification',
      audioEnabled: true,
      showNoteNames: false,
      favoritePieces: [],

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
    }),
    {
      name: 'miditutor-settings',
    },
  ),
);
