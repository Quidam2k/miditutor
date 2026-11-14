// #6105: an opt-in, on-screen "check your wrists" line, shown only at a pause in his playing.

/** How long with no notes counts as a pause. */
export const WRIST_PAUSE_MS = 20_000;

export interface WristState {
  /** The setting; off means nothing ever fires. */
  on: boolean;
  now: number;
  /** When his last note event arrived (this machine's clock); null = he hasn't played yet. */
  lastNoteAt: number | null;
  /** A key is down right now. */
  holding: boolean;
  /** The line was already shown for this pause. */
  shown: boolean;
}

/** True when the reminder should appear now: on, he has played, nothing is held, 20 s+ of quiet, once per pause. */
export function shouldRemind(s: WristState): boolean {
  if (!s.on || s.shown || s.holding || s.lastNoteAt === null) return false;
  return s.now - s.lastNoteAt >= WRIST_PAUSE_MS;
}
