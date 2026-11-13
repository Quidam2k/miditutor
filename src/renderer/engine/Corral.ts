/**
 * #6062 adaptive corral: controls he has not touched for CORRAL_AFTER_SESSIONS sessions fold into a
 * "More" menu; one he uses from there comes back to the front row. Pure rules, no DOM: the toolbar
 * feeds usage in and asks which ids go on the front row.
 */

/** Todd said "five or ten". */
export const CORRAL_AFTER_SESSIONS = 7;
/**
 * He said that hiding a control that is ON but just left on is fine (msg 60575), and to tell us if that
 * annoys him. true = a control that is ON stays on the front row whether or not he touches it.
 */
export const ON_STAYS_VISIBLE = false;
/** Same quiet gap as the Practiced meter (PRACTICE_IDLE_MS). */
export const SESSION_QUIET_MS = 10 * 60 * 1000;
/** Never folded away: they silence or test something he must be able to see (our rule, not his words). */
export const NEVER_HIDE: ReadonlySet<string> = new Set(['missSound']);

export interface Usage {
  uses: number;
  lastUsedAt: number;
  /** Session number (1-based) of the last use; absent = never used. */
  lastSession?: number;
  perDay: Record<string, number>;
}
export interface CorralData {
  /** Sessions recorded so far. */
  sessions: number;
  controls: Record<string, Usage>;
}
export const emptyCorral = (): CorralData => ({ sessions: 0, controls: {} });

/** Record a click or change on control `id` in the current session. */
export function recordUse(data: CorralData, id: string, now: number): CorralData {
  const old = data.controls[id];
  const day = new Date(now).toISOString().slice(0, 10);
  const usage: Usage = {
    uses: (old?.uses ?? 0) + 1,
    lastUsedAt: now,
    lastSession: Math.max(1, data.sessions),
    perDay: { ...old?.perDay, [day]: (old?.perDay?.[day] ?? 0) + 1 },
  };
  return { ...data, controls: { ...data.controls, [id]: usage } };
}

/**
 * Is `id` on the front row? `staticFront` is the day-one split. With fewer than N recorded sessions
 * nothing auto-hides and the static split stands, except a corral control he has used comes forward.
 * Hiding never changes a control's state: this only decides where it is drawn.
 */
export function onFront(data: CorralData, id: string, staticFront: boolean, isOn: boolean): boolean {
  if (NEVER_HIDE.has(id)) return true;
  if (ON_STAYS_VISIBLE && isOn) return true;
  const last = data.controls[id]?.lastSession;
  if (last !== undefined && data.sessions - last < CORRAL_AFTER_SESSIONS) return true; // used lately
  if (!staticFront) return false; // never used or long unused, and it started in the corral
  return last === undefined && data.sessions < CORRAL_AFTER_SESSIONS; // front-row, untouched, still thin data
}

/** The ids on the front row, in their fixed order. */
export function frontRow(data: CorralData, order: readonly string[], staticFront: (id: string) => boolean, on: (id: string) => boolean): string[] {
  return order.filter((id) => onFront(data, id, staticFront(id), on(id)));
}

/** Hidden controls that are ON, for the "N on" count on the More button. */
export function hiddenOnCount(front: readonly string[], order: readonly string[], on: (id: string) => boolean): number {
  return order.filter((id) => !front.includes(id) && on(id)).length;
}

/**
 * Counts sessions. A session starts when the tutor invite turns on, or, with no invite, at the first note
 * after a quiet gap; it ends at invite-off or after SESSION_QUIET_MS without a note. One stretch of playing
 * is never counted twice: invite-on followed by the first note is ONE session.
 */
export interface SessionClock {
  active: boolean;
  lastActivityAt: number;
  /** Sessions started since the clock was made. */
  started: number;
}
export const newClock = (): SessionClock => ({ active: false, lastActivityAt: -Infinity, started: 0 });

export function clockEvent(c: SessionClock, kind: 'invite-on' | 'invite-off' | 'note', now: number): SessionClock {
  const quiet = now - c.lastActivityAt >= SESSION_QUIET_MS;
  if (kind === 'invite-off') return { ...c, active: false, lastActivityAt: c.active ? now : c.lastActivityAt };
  if (c.active && !quiet) return { ...c, lastActivityAt: now };
  // Right after a session ended (invite-off), a note is still the same stretch of playing.
  if (!c.active && !quiet) return { ...c, lastActivityAt: now };
  return { active: true, lastActivityAt: now, started: c.started + 1 };
}
