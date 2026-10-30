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
  /** A loop the API asked for (bars, 1-based); null = clear. `seq` makes repeats distinct. */
  loopRequest: { seq: number; firstBar: number; lastBar: number; backwards?: boolean } | { seq: number; clear: true } | null;
  /** #5259: a homework line asked for this piece; the Score view takes it and clears it. */
  pieceRequest: { pieceId: string; backwards: boolean } | null;
  requestPiece: (pieceId: string, backwards: boolean) => void;
  clearPieceRequest: () => void;
  clearLoopRequest: () => void;
  setTask: (task: Task | null) => void;
  requestLoop: (bars: { firstBar: number; lastBar: number; backwards?: boolean } | null) => void;
  addPiece: (p: Omit<PushedPiece, 'id'>) => void;
}

let pieceSeq = 0;
let loopSeq = 0;

export const useTutorStore = create<TutorState>((set) => ({
  task: null,
  pieces: [],
  selectPieceId: null,
  loopRequest: null,
  pieceRequest: null,
  requestPiece: (pieceId, backwards) => set({ pieceRequest: { pieceId, backwards } }),
  clearPieceRequest: () => set({ pieceRequest: null }),
  clearLoopRequest: () => set({ loopRequest: null }),
  setTask: (task) => set({ task }),
  requestLoop: (bars) => set({ loopRequest: bars ? { seq: ++loopSeq, ...bars } : { seq: ++loopSeq, clear: true } }),
  addPiece: (p) =>
    set((s) => {
      const id = `pushed-${++pieceSeq}`;
      return { pieces: [...s.pieces, { ...p, id }], selectPieceId: id };
    }),
}));
