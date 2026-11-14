// #6122: the latest rep boundary (a lap or the piece finished; Keep-going or Restart began one),
// for the opt-in wrist reminder. Pure notice board: nothing here plays, shows or times anything.
import { create } from 'zustand';
import type { RepEvent } from '../engine/WristReminder';

interface RepStore {
  event: (RepEvent & { id: number }) | null;
}

let counter = 0;

export const useRepStore = create<RepStore>(() => ({ event: null }));

export function emitRep(kind: RepEvent['kind']): void {
  useRepStore.setState({ event: { kind, at: Date.now(), id: ++counter } });
}
