// #10236: what a relaunch puts back. Saved through main to session.json, atomically, so a
// kill can't lose it. A patch relaunch (force) restores it however old; an ordinary launch
// only if it's recent, so opening the app days later doesn't drop him mid-lap in an old drill.
import type { ChunkState } from '../../engine/BackwardChunk';

export interface SessionSnapshot {
  at: number;
  pieceId: string;
  pieceLabel: string;
  loop: { first: number; last: number } | null;
  chunk: ChunkState | null;
  lap: number;
  wrongCount: number;
  /** Wrong notes in the lap under way, so a lap cut by the relaunch doesn't count as clean. */
  lapWrong: number;
  step: number;
  hand: 'both' | 'right' | 'left';
  following: boolean;
  showOriginal: boolean;
}

export const RESTORE_MAX_AGE_MS = 30 * 60 * 1000;

const isBar = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1;
const isCount = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0;

function parseLoop(v: unknown): SessionSnapshot['loop'] {
  const l = v as { first?: unknown; last?: unknown } | null;
  return l && isBar(l.first) && isBar(l.last) && l.first <= l.last ? { first: l.first, last: l.last } : null;
}

function parseChunk(v: unknown): ChunkState | null {
  const c = v as Partial<ChunkState> | null;
  if (!c || !isBar(c.first) || !isBar(c.last) || !isBar(c.start) || !isCount(c.clean) || !isBar(c.need)) return null;
  if (c.first > c.start || c.start > c.last) return null;
  return { first: c.first, last: c.last, start: c.start, clean: c.clean, need: c.need, done: c.done === true };
}

/** The snapshot to restore, or null: nothing saved, too old, or not something we wrote. */
export function restorable(raw: unknown, force: boolean, now: number): SessionSnapshot | null {
  const s = raw as Partial<SessionSnapshot> | null;
  if (!s || typeof s !== 'object' || typeof s.at !== 'number' || typeof s.pieceId !== 'string') return null;
  if (!force && (now - s.at > RESTORE_MAX_AGE_MS || now < s.at)) return null;
  const loop = parseLoop(s.loop);
  const chunk = loop ? parseChunk(s.chunk) : null;
  return {
    at: s.at,
    pieceId: s.pieceId,
    pieceLabel: typeof s.pieceLabel === 'string' ? s.pieceLabel : '',
    loop,
    // A chunk is only good on the loop it runs: start..last.
    chunk: chunk && loop && chunk.start === loop.first && chunk.last === loop.last ? chunk : null,
    lap: isBar(s.lap) ? s.lap : 1,
    wrongCount: isCount(s.wrongCount) ? s.wrongCount : 0,
    lapWrong: isCount(s.lapWrong) ? s.lapWrong : 0,
    step: isCount(s.step) ? s.step : 0,
    hand: s.hand === 'right' || s.hand === 'left' ? s.hand : 'both',
    following: s.following !== false,
    showOriginal: s.showOriginal === true,
  };
}

// One read per launch: the Score tab remounts on every tab switch, and only the first
// mount after a launch may restore.
let loading: Promise<SessionSnapshot | null> | null = null;
let claimed = false;

/**
 * Read it now, at launch, whichever tab he lands on: this uses up the patch marker, which
 * must not wait for a Score visit on some later launch and force a days-old restore then.
 */
export function readStartupSnapshot(): Promise<SessionSnapshot | null> {
  loading ??= (window.tutorBridge?.sessionLoad?.() ?? Promise.resolve(null)).then(
    (r) => (r ? restorable(r.snapshot, r.force, Date.now()) : null),
    (err: unknown) => {
      console.warn('[session] load failed:', err);
      return null;
    },
  );
  return loading;
}

export function loadStartupSnapshot(): Promise<SessionSnapshot | null> {
  return readStartupSnapshot().then((snap) => {
    const out = claimed ? null : snap;
    claimed = true;
    return out;
  });
}
