// #6371 Build outward: start on a short trouble spot, and after enough clean
// laps add a bar on each side, until it fills the bigger span.
// JP 11/13: fix them in isolation, then expand around it.

import { loopEnd, targetFor, type ChunkState } from './BackwardChunk';

type Span = { first: number; last: number };

export function outerFor(bars: Span, stars: Span[], whole: Span): Span {
  const core = { first: Math.min(bars.first, bars.last), last: Math.max(bars.first, bars.last) };
  let best: Span | undefined;
  for (const star of stars) {
    if (star.first > core.first || star.last < core.last) continue;
    if (star.first === core.first && star.last === core.last) continue;

    const width = star.last - star.first;
    if (!best || width < best.last - best.first ||
        (width === best.last - best.first && star.first < best.first)) {
      best = star;
    }
  }
  // A star typed past the score's end only reaches as far as the music does.
  return best ? { first: Math.max(best.first, whole.first), last: Math.min(best.last, whole.last) } : whole;
}

export function startOutward(core: Span, outer: Span, targets: number[]): ChunkState {
  const first = Math.min(outer.first, outer.last);
  const last = Math.max(outer.first, outer.last);
  const start = Math.min(last, Math.max(first, Math.min(core.first, core.last)));
  const end = Math.min(last, Math.max(first, Math.max(core.first, core.last)));
  return { first, last, start, end, clean: 0, need: targetFor(targets, 0), done: false, out: true, grown: 0 };
}

export function outwardLapDone(
  s: ChunkState,
  wrongInLap: number,
  targets: number[],
): { state: ChunkState; grew: boolean; reached: boolean } {
  if (wrongInLap > 0) return { state: s, grew: false, reached: false };

  const clean = s.clean + 1;
  const grown = s.grown ?? 0;
  const need = targetFor(targets, grown);
  if (s.done || clean < need) {
    return { state: { ...s, clean, need }, grew: false, reached: false };
  }

  const end = loopEnd(s);
  if (s.start <= s.first && end >= s.last) {
    return { state: { ...s, clean, need, done: true }, grew: false, reached: true };
  }

  return {
    state: {
      ...s,
      start: Math.max(s.first, s.start - 1),
      end: Math.min(s.last, end + 1),
      grown: grown + 1,
      clean: 0,
      need: targetFor(targets, grown + 1),
    },
    grew: true,
    reached: false,
  };
}

export function outwardRangeEdited(s: ChunkState, first: number, last: number, targets: number[]): ChunkState {
  let end = loopEnd(s);
  if (first <= s.start && last >= end) {
    return { ...s, first, last, end, done: s.done && s.start === first && end === last };
  }

  let start = Math.max(s.start, first);
  end = Math.min(end, last);
  if (start > end) {
    start = first;
    end = first;
  }
  return { ...s, first, last, start, end, clean: 0, need: targetFor(targets, s.grown ?? 0), done: false };
}

export function outwardLabel(s: ChunkState): string {
  if (s.done) return `Outward: whole range ${s.first}–${s.last} · ${s.clean} clean laps`;

  const end = loopEnd(s);
  const bars = s.start === end ? `bar ${s.start}` : `bars ${s.start}–${end}`;
  return `Outward: ${bars} of ${s.first}–${s.last} · clean ${s.clean}/${s.need}`;
}

export function outwardGrewLabel(s: ChunkState): string {
  return `Grew: now looping ${s.start}–${loopEnd(s)}, ${s.need} clean laps to go`;
}

/** #6371: at most this many starred ranges per piece. */
export const MAX_STARS = 8;

/** Star or unstar a range; the list stays shortest first, and a 9th star drops the oldest. */
export function toggleSpan(list: Span[], bars: Span): Span[] {
  const span = { first: Math.min(bars.first, bars.last), last: Math.max(bars.first, bars.last) };
  if (list.some((s) => s.first === span.first && s.last === span.last)) {
    return list.filter((s) => s.first !== span.first || s.last !== span.last);
  }
  return [...list, span].slice(-MAX_STARS);
}

/** His stars on one piece (an own key only: a piece called "constructor" has none). */
export function starsOf(all: Record<string, Span[]>, title: string): Span[] {
  return Object.hasOwn(all, title) ? all[title] : [];
}

/** The dropdown's order: shortest first, then by first bar. */
export function starsInOrder(list: Span[]): Span[] {
  return [...list].sort((a, b) => a.last - a.first - (b.last - b.first) || a.first - b.first);
}
