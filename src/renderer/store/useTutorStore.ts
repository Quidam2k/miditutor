import { create } from 'zustand';
import type { Task } from '../../main/tutorApi';

// What the personas have put on screen through the tutor API: the current
// chord task (if any) and pieces pushed this session. The Score view reads
// pushed pieces alongside its built-in ones.

export interface PushedPiece {
  id: string;
  label: string;
  xml: string;
  photo?: string; // data URL of the original sheet photo, when the piece came from OMR
}

interface TutorState {
  task: Task | null;
  pieces: PushedPiece[];
  /** Bumped when a piece is pushed, so the Score view selects it. */
  selectPieceId: string | null;
  setTask: (task: Task | null) => void;
  addPiece: (p: Omit<PushedPiece, 'id'>) => void;
}

let pieceSeq = 0;

export const useTutorStore = create<TutorState>((set) => ({
  task: null,
  pieces: [],
  selectPieceId: null,
  setTask: (task) => set({ task }),
  addPiece: (p) =>
    set((s) => {
      const id = `pushed-${++pieceSeq}`;
      return { pieces: [...s.pieces, { ...p, id }], selectPieceId: id };
    }),
}));
