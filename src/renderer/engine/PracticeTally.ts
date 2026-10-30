// #10240: how long he has been practicing, for the top bar. Counts from the first note.
// A gap of more than 10 minutes (the "Tutor on" idle rule) isn't practice and isn't counted;
// after more than an hour away, the next note starts a new session at zero.
export const PRACTICE_IDLE_MS = 10 * 60 * 1000;
export const PRACTICE_RESET_MS = 60 * 60 * 1000;

export interface PracticeTally {
  lastNoteAt: number;
  totalMs: number;
}

export function tallyNote(t: PracticeTally | null, now: number): PracticeTally {
  if (!t) return { lastNoteAt: now, totalMs: 0 };
  const gap = now - t.lastNoteAt;
  if (gap > PRACTICE_RESET_MS) return { lastNoteAt: now, totalMs: 0 };
  // A clock set back a little adds nothing and takes nothing away.
  return { lastNoteAt: now, totalMs: t.totalMs + (gap < 0 || gap > PRACTICE_IDLE_MS ? 0 : gap) };
}

/** The count, as "0:07" (hours:minutes). */
export function practiceLabel(totalMs: number): string {
  const minutes = Math.floor(totalMs / 60000);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

export function parseTally(raw: string | null): PracticeTally | null {
  try {
    const t = JSON.parse(raw ?? 'null') as Partial<PracticeTally> | null;
    return t && Number.isFinite(t.lastNoteAt) && Number.isFinite(t.totalMs)
      ? { lastNoteAt: t.lastNoteAt as number, totalMs: t.totalMs as number }
      : null;
  } catch {
    return null;
  }
}
