import { create } from 'zustand';

interface SessionState {
  totalAttempts: number;
  correctAttempts: number;
  currentStreak: number;
  bestStreak: number;
  sessionStartTime: number | null;

  recordResult: (correct: boolean) => void;
  reset: () => void;
  startSession: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  totalAttempts: 0,
  correctAttempts: 0,
  currentStreak: 0,
  bestStreak: 0,
  sessionStartTime: null,

  recordResult: (correct) =>
    set((state) => {
      const newStreak = correct ? state.currentStreak + 1 : 0;
      return {
        totalAttempts: state.totalAttempts + 1,
        correctAttempts: state.correctAttempts + (correct ? 1 : 0),
        currentStreak: newStreak,
        bestStreak: Math.max(state.bestStreak, newStreak),
      };
    }),

  reset: () =>
    set({ totalAttempts: 0, correctAttempts: 0, currentStreak: 0, bestStreak: 0, sessionStartTime: null }),

  startSession: () =>
    set((state) => ({
      sessionStartTime: state.sessionStartTime ?? Date.now(),
    })),
}));
