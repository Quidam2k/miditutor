// #6460 trouble spots: bars he misses or hesitates on, kept as a per-piece list;
// one comes off only after N clean loops of the spot alone AND N clean passes
// through a bigger range (Todd msg 63713).

export type Span = { first: number; last: number };

export interface Spot extends Span {
  alone: number;
  inContext: number;
  added: string; // YYYY-MM-DD
  auto?: true;
  ticked?: string; // YYYY-MM-DD it came off
}

export interface Dismissed extends Span {
  at: number; // ms
}

export const SPOT_KEEP_DAYS = 7;
export const AUTO_MIN = 3;
export const AUTO_MAX_PER_CHECK = 3;
// #6513: a whole-piece check only tops his open list up to this many, so 20 bad bars don't bury him.
export const AUTO_OPEN_CAP = 6;
export const MAX_SPOT_BARS = 5;

const DAY_MS = 86_400_000;

function sameSpan(a: Span, b: Span): boolean {
  return a.first === b.first && a.last === b.last;
}

function localDay(day: string): Date {
  return new Date(`${day}T00:00:00`);
}

function keepFrom(today: string): number {
  const day = localDay(today);
  return day.setDate(day.getDate() - SPOT_KEEP_DAYS);
}

export function spotAround(bar: number, whole: Span): Span {
  return {
    first: Math.min(whole.last, Math.max(whole.first, bar - 1)),
    last: Math.min(whole.last, Math.max(whole.first, bar + 1)),
  };
}

export type BarWeight = { bar: number; weight: number };

/**
 * #6530 window rule (Todd msg 64399): a lone rough bar is a 3-bar loop (bar before, it, bar
 * after); rough bars close together share one loop of 4-5 bars. Picks non-overlapping windows,
 * best first, by trouble per bar (weight / window length), so a loop only grows when the extra
 * bars carry misses of their own. Windows never overlap `blocked` or each other.
 */
export function clusterWindows(bars: BarWeight[], whole: Span, blocked: Span[] = []): Span[] {
  const pts = bars.filter(b => b.weight > 0 && b.bar >= whole.first && b.bar <= whole.last)
    .sort((a, b) => a.bar - b.bar);
  const out: Span[] = [];
  const used = new Set<number>();
  const hits = (s: Span, o: Span) => s.first <= o.last && s.last >= o.first;
  // Pad the core to 3-5 bars (a bar of lead-in first), inside the piece, clear of other windows.
  const fit = (core: Span): Span | null => {
    const others = [...blocked, ...out];
    if (others.some(o => hits(core, o))) return null;
    const len = core.last - core.first + 1;
    const want = Math.min(MAX_SPOT_BARS, Math.max(3, len + 2));
    const before = want > len ? 1 : 0;
    let first = Math.max(whole.first, core.first - before);
    let last = Math.min(whole.last, core.last + (want - len - before));
    for (const o of others) {
      if (o.last < core.first && o.last >= first) first = o.last + 1;
      if (o.first > core.last && o.first <= last) last = o.first - 1;
    }
    // Clipped by a neighbour: grow on the free side, back to 3 bars where the piece allows.
    const free = (bar: number) => bar >= whole.first && bar <= whole.last && !others.some(o => bar >= o.first && bar <= o.last);
    while (last - first + 1 < 3 && free(last + 1)) last++;
    while (last - first + 1 < 3 && free(first - 1)) first--;
    return { first, last };
  };
  for (;;) {
    let best: { span: Span; score: number; from: number; to: number } | null = null;
    for (let i = 0; i < pts.length; i++) {
      if (used.has(i)) continue;
      let weight = 0;
      for (let j = i; j < pts.length && !used.has(j); j++) {
        // Rough bars within 3 of each other share a loop, keeping a bar before and after: 4-5 bars.
        if (pts[j].bar - pts[i].bar + 1 > MAX_SPOT_BARS - 2) break;
        weight += pts[j].weight;
        const span = fit({ first: pts[i].bar, last: pts[j].bar });
        if (!span) continue;
        const score = weight / (span.last - span.first + 1);
        if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && j - i > best.to - best.from)) {
          best = { span, score, from: i, to: j };
        }
      }
    }
    if (!best) return out;
    out.push(best.span);
    for (let k = best.from; k <= best.to; k++) used.add(k);
  }
}

export function addSpot(spots: Spot[], span: Span, today: string, auto = false): Spot[] {
  const bounds = { first: Math.min(span.first, span.last), last: Math.max(span.first, span.last) };
  if (spots.some(spot => !spot.ticked && sameSpan(spot, bounds))) return spots;

  const fresh: Spot = { ...bounds, alone: 0, inContext: 0, added: today, ...(auto ? { auto: true } : {}) };
  const index = spots.findIndex(spot => sameSpan(spot, bounds));
  if (index === -1) return [...spots, fresh];

  const updated = spots.slice();
  updated[index] = fresh;
  return updated;
}

export function removeSpot(spots: Spot[], span: Span): Spot[] {
  return spots.filter(spot => !sameSpan(spot, span));
}

export function countPass(
  spots: Spot[],
  lap: Span,
  wrongBars: ReadonlySet<number>,
  need: number,
  today: string,
): { spots: Spot[]; ticked: Spot[] } {
  const ticked: Spot[] = [];
  const updated = spots.map(spot => {
    if (spot.ticked) return spot;

    let { alone, inContext } = spot;
    if (lap.first >= spot.first && lap.last <= spot.last) {
      if (wrongBars.size === 0) alone++;
    } else if (lap.first <= spot.first && lap.last >= spot.last) {
      // Misses outside the spot do not spoil this pass.
      if (![...wrongBars].some(bar => bar >= spot.first && bar <= spot.last)) inContext++;
    }

    if (alone >= need && inContext >= need) {
      const done = { ...spot, alone, inContext, ticked: today };
      ticked.push(done);
      return done;
    }
    return alone === spot.alone && inContext === spot.inContext ? spot : { ...spot, alone, inContext };
  });
  return { spots: updated, ticked };
}

export function prune(spots: Spot[], today: string): Spot[] {
  const cutoff = keepFrom(today);
  return spots.filter(spot => !spot.ticked || localDay(spot.ticked).getTime() >= cutoff);
}

export interface SpotMerge {
  at: number; // ms
  from: Spot[]; // the spots it replaced, as they were (for undo)
  to: Span;
}

// An auto spot he hasn't started on (no clean lap of it alone yet): a new window may absorb it.
const loose = (spot: Spot) => spot.auto === true && !spot.ticked && spot.alone === 0;

export function autoSpots(
  spots: Spot[],
  dismissed: Dismissed[],
  bars: { bar: number; misses: number; hesitations: number }[],
  range: Span,
  whole: Span,
  now: number,
  today: string,
  recentMisses: (bar: number, since: number) => number,
  max = AUTO_MAX_PER_CHECK,
): { spots: Spot[]; added: Span[]; merged: SpotMerge[] } {
  const dismissedCutoff = now - SPOT_KEEP_DAYS * DAY_MS;
  const tickedCutoff = keepFrom(today);
  const added: Span[] = [];
  const merged: SpotMerge[] = [];
  const inside = (bar: number, s: Span) => bar >= s.first && bar <= s.last;
  // Spots he is working on (or set himself) stay as they are; windows go around them.
  const blocked = spots.filter(spot => !spot.ticked && !loose(spot));

  const rough: BarWeight[] = [];
  for (const { bar, misses, hesitations } of bars) {
    if (bar < range.first || bar > range.last) continue;
    if (!(misses + hesitations >= AUTO_MIN)) continue;
    if (blocked.some(spot => inside(bar, spot))) continue;
    // A spot he removed or ticked off this week comes back only after new misses since.
    let since = -Infinity;
    for (const entry of dismissed) {
      if (entry.at > dismissedCutoff && inside(bar, entry)) since = Math.max(since, entry.at);
    }
    for (const spot of spots) {
      if (!spot.ticked || !inside(bar, spot)) continue;
      const at = localDay(spot.ticked).getTime();
      if (at >= tickedCutoff) since = Math.max(since, at);
    }
    if (since !== -Infinity && !(recentMisses(bar, since) >= AUTO_MIN)) continue;
    rough.push({ bar, weight: misses + hesitations });
  }

  let updated = spots;
  for (const win of clusterWindows(rough, whole, blocked)) {
    const absorbed = updated.filter(spot => loose(spot) && spot.first <= win.last && spot.last >= win.first);
    if (absorbed.length) {
      // One loose spot that already holds every rough bar of this window stays put (no churn).
      const roughIn = rough.filter(r => inside(r.bar, win));
      if (absorbed.length === 1 && roughIn.every(r => inside(r.bar, absorbed[0]))) continue;
      const kept = updated.filter(spot => !absorbed.includes(spot));
      const into: Spot = {
        ...win, alone: 0, auto: true,
        inContext: Math.max(...absorbed.map(spot => spot.inContext)),
        added: absorbed.map(spot => spot.added).sort()[0],
      };
      updated = [...kept.filter(spot => !sameSpan(spot, win)), into];
      merged.push({ at: now, from: absorbed, to: win });
      continue;
    }
    if (added.length >= max) continue;
    const next = addSpot(updated, win, today, true);
    if (next === updated) continue;
    updated = next;
    added.push(win);
  }
  return { spots: updated, added, merged };
}

/** Undo a merge: its window comes off and the spots it replaced come back. */
export function undoMerge(spots: Spot[], merge: SpotMerge): Spot[] {
  const rest = spots.filter(spot => !sameSpan(spot, merge.to));
  return [...rest.filter(spot => !merge.from.some(f => sameSpan(f, spot))), ...merge.from];
}

export function spotLabel(spot: Spot, need: number): string {
  const bars = spot.first === spot.last ? `Bar ${spot.first}` : `Bars ${spot.first}–${spot.last}`;
  if (spot.ticked) {
    const day = localDay(spot.ticked);
    return `✓ ${bars} · off ${day.getMonth() + 1}/${day.getDate()}`;
  }
  return `${bars} · alone ${Math.min(spot.alone, need)}/${need} · in context ${Math.min(spot.inContext, need)}/${need}`;
}
