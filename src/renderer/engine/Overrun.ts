// #5945: a short grace after a loop's end. A note he plays just past the loop's last
// step (the piece carrying on) is an overrun: it still thuds, but it is not a failure.
import type { ScoreStep } from './ScoreFollower';

/** How long after a loop wraps its overrun notes stay forgiven (Todd: "1-2 second"). */
export const GRACE_MS = 1500;

export interface Overrun {
  /** Clock time the loop wrapped (the note that closed it, or the lap's end). */
  wrapMs: number;
  /** The step past the loop's end that he should be playing next. */
  pos: number;
  /** Notes of `pos` already struck (a chord arrives a key at a time). */
  struck: Set<number>;
}

/** The first step after `last` with something to play, or -1 when the piece ends there. */
function nextPlayable(steps: ScoreStep[], last: number): number {
  for (let i = last + 1; i < steps.length; i++) if (steps[i].notes.length > 0) return i;
  return -1;
}

/** Open the grace window at a wrap; null when nothing follows the loop. */
export function startOverrun(steps: ScoreStep[], last: number, wrapMs: number): Overrun | null {
  const pos = nextPlayable(steps, last);
  return pos < 0 ? null : { wrapMs, pos, struck: new Set() };
}

/**
 * Is `midi`, struck at `t`, the piece carrying on past the loop? Only a note that the
 * next step past the loop's end asks for counts, inside GRACE_MS of the wrap; as he
 * plays on, the expected step moves on with him. Anything else stays a wrong note.
 */
export function overrunNote(o: Overrun | null, steps: ScoreStep[], midi: number, t: number): boolean {
  if (!o || t - o.wrapMs > GRACE_MS || t < o.wrapMs) return false;
  const notes = steps[o.pos]?.notes;
  if (!notes || !notes.includes(midi) || o.struck.has(midi)) return false;
  o.struck.add(midi);
  if (o.struck.size >= notes.length) {
    const next = nextPlayable(steps, o.pos);
    o.struck.clear();
    o.pos = next < 0 ? steps.length : next;
  }
  return true;
}
