import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Clef } from '../types/music';
import { ExerciseType } from '../types/exercise';

/** Strip = one long line of music, current beat centred (#5153); pages / scroll (#5137). */
export type ScoreLayout = 'strip' | 'pages' | 'scroll';

interface SettingsState {
  clef: Clef;
  exerciseType: ExerciseType;
  audioEnabled: boolean;
  showNoteNames: boolean;
  showKeyboard: boolean;
  scoreLayout: ScoreLayout;
  /** Score-tab pieces pinned to the top of the list, by displayed title (#9610). */
  favoritePieces: string[];
  /** Version group slug -> the file of the version he last switched to (#9627). */
  pieceVersions: Record<string, string>;
  /** Interval drill: right answers today toward JP's 10 a day (local date, YYYY-MM-DD). */
  intervalGoal: { day: string; correct: number };
  /** Homework item id -> local day he last finished it on the keyboard (#5058). */
  homeworkPracticed: Record<string, string>;
  /** #10133 Build backwards: clean laps each chunk needs, e.g. "3,5" (3 first, then 5). */
  backwardTargets: string;
  /** #10160: the Score tab's piece at last look (id, and its title for a pushed piece). */
  lastPiece: { id: string; label: string } | null;
  /** #10162: the tab he was on, so a restart reopens it. */
  lastView: string;

  setClef: (clef: Clef) => void;
  setExerciseType: (type: ExerciseType) => void;
  setAudioEnabled: (enabled: boolean) => void;
  setShowKeyboard: (show: boolean) => void;
  setShowNoteNames: (show: boolean) => void;
  setScoreLayout: (layout: ScoreLayout) => void;
  setBackwardTargets: (text: string) => void;
  setLastPiece: (piece: { id: string; label: string }) => void;
  setLastView: (view: string) => void;
  toggleFavoritePiece: (title: string) => void;
  setPieceVersion: (slug: string, file: string) => void;
  countIntervalCorrect: () => void;
  markHomeworkPracticed: (id: string) => void;
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
      showKeyboard: true,
      // He plays the notes himself; the tutor only sounds when he asks (#5059).
      audioEnabled: false,
      showNoteNames: false,
      scoreLayout: 'strip',
      favoritePieces: [],
      pieceVersions: {},
      intervalGoal: { day: '', correct: 0 },
      homeworkPracticed: {},
      backwardTargets: '3,5',
      lastPiece: null,
      lastView: 'practice',

      setClef: (clef) => set({ clef }),
      setShowKeyboard: (show) => set({ showKeyboard: show }),
      setExerciseType: (type) => set({ exerciseType: type }),
      setAudioEnabled: (enabled) => set({ audioEnabled: enabled }),
      setShowNoteNames: (show) => set({ showNoteNames: show }),
      setScoreLayout: (layout) => set({ scoreLayout: layout }),
      setBackwardTargets: (text) => set({ backwardTargets: text }),
      setLastPiece: (piece) => set({ lastPiece: piece }),
      setLastView: (view) => set({ lastView: view }),
      toggleFavoritePiece: (title) =>
        set((s) => ({
          favoritePieces: s.favoritePieces.includes(title)
            ? s.favoritePieces.filter((t) => t !== title)
            : [...s.favoritePieces, title],
        })),
      setPieceVersion: (slug, file) => set((s) => ({ pieceVersions: { ...s.pieceVersions, [slug]: file } })),
      countIntervalCorrect: () =>
        set((s) => {
          const day = localDay();
          return { intervalGoal: { day, correct: (s.intervalGoal.day === day ? s.intervalGoal.correct : 0) + 1 } };
        }),
      markHomeworkPracticed: (id) => set((s) => ({ homeworkPracticed: { ...s.homeworkPracticed, [id]: localDay() } })),
    }),
    {
      name: 'miditutor-settings',
      // v1 (#5059): Audio now defaults OFF; turn off the ON every earlier install saved.
      // v2 (#5153): he asked for the strip layout as the default; move him to it once.
      version: 2,
      migrate: (persisted, version) => {
        let state = persisted as Partial<SettingsState>;
        if (version < 1) state = { ...state, audioEnabled: false };
        if (version < 2) state = { ...state, scoreLayout: 'strip' };
        return state as SettingsState;
      },
    },
  ),
);
