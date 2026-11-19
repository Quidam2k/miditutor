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

export function autoSpots(
  spots: Spot[],
  dismissed: Dismissed[],
  bars: { bar: number; misses: number; hesitations: number }[],
  range: Span,
  whole: Span,
  now: number,
  today: string,
  recentMisses: (bar: number, since: number) => number,
): { spots: Spot[]; added: Span[] } {
  const dismissedCutoff = now - SPOT_KEEP_DAYS * DAY_MS;
  const tickedCutoff = keepFrom(today);
  const added: Span[] = [];
  let updated = spots;

  for (const { bar, misses, hesitations } of bars) {
    if (bar < range.first || bar > range.last) continue;
    if (!(misses + hesitations >= AUTO_MIN)) continue;
    if (updated.some(spot => !spot.ticked && bar >= spot.first && bar <= spot.last)) continue;

    const span = spotAround(bar, whole);
    // Count new misses from the most recent time the spot came off.
    let since = -Infinity;
    for (const entry of dismissed) {
      if (entry.at > dismissedCutoff && sameSpan(entry, span)) since = Math.max(since, entry.at);
    }
    for (const spot of updated) {
      if (!spot.ticked || !sameSpan(spot, span)) continue;
      const at = localDay(spot.ticked).getTime();
      if (at >= tickedCutoff) since = Math.max(since, at);
    }
    if (since !== -Infinity && !(recentMisses(bar, since) >= AUTO_MIN)) continue;

    const next = addSpot(updated, span, today, true);
    if (next === updated) continue;
    updated = next;
    added.push(span);
    if (added.length === AUTO_MAX_PER_CHECK) break;
  }
  return { spots: updated, added };
}

export function spotLabel(spot: Spot, need: number): string {
  const bars = spot.first === spot.last ? `Bar ${spot.first}` : `Bars ${spot.first}–${spot.last}`;
  if (spot.ticked) {
    const day = localDay(spot.ticked);
    return `✓ ${bars} · off ${day.getMonth() + 1}/${day.getDate()}`;
  }
  return `${bars} · alone ${Math.min(spot.alone, need)}/${need} · in context ${Math.min(spot.inContext, need)}/${need}`;
}
