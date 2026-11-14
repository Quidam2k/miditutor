// #6105/#6122: an opt-in, on-screen "check your wrists" line, shown only when his hands are still.
// One cue per pause, total: whichever of the three rules below fires first, the others wait for his next note.

/** How long with no notes counts as a pause (his "pause for a minute"). */
export const WRIST_PAUSE_MS = 60_000;
/** After a rep ends, keys up and this much quiet before the end-of-rep line. */
export const REP_QUIET_MS = 2_000;
/** A note this long after a rep ended means he played on into the next one: no end-of-rep line. */
export const REP_GRACE_MS = 300;

export interface WristState {
  /** The setting; off means nothing ever fires. */
  on: boolean;
  now: number;
  /** When his last note event arrived (this machine's clock); null = he hasn't played yet. */
  lastNoteAt: number | null;
  /** A key is down right now. */
  holding: boolean;
  /** A cue was already shown for this pause. */
  shown: boolean;
}

/** True when the reminder should appear now: on, he has played, nothing is held, 60 s+ of quiet, once per pause. */
export function shouldRemind(s: WristState): boolean {
  if (!s.on || s.shown || s.holding || s.lastNoteAt === null) return false;
  return s.now - s.lastNoteAt >= WRIST_PAUSE_MS;
}

/**
 * A rep is one lap of his loop (the whole piece once when there is no loop), or one Keep-going lap.
 * 'start': Keep-going begins, or he pressed Restart. 'end': a lap or the piece just finished.
 */
export interface RepEvent {
  kind: 'start' | 'end';
  /** When it happened (this machine's clock). */
  at: number;
}

export interface RepState extends WristState {
  event: RepEvent | null;
}

/**
 * The start/end-of-rep line. Never while a key is down or after a cue was already shown this pause.
 * Start: only before his first note of the rep. End: keys up and 2 s of quiet, and not if he played on
 * into the next lap (a wrap straight into the next lap shows nothing).
 */
export function repPrompt(s: RepState): boolean {
  const e = s.event;
  if (!s.on || s.shown || s.holding || !e) return false;
  if (e.kind === 'start') return s.lastNoteAt === null || s.lastNoteAt <= e.at;
  if (s.lastNoteAt !== null && s.lastNoteAt - e.at > REP_GRACE_MS) return false;
  return s.now - Math.max(e.at, s.lastNoteAt ?? 0) >= REP_QUIET_MS;
}
