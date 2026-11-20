// #6530 E: the tutor's own advice, one banner at a time.
// At most one banner every 5 minutes; "Not today" quiets that rule until tomorrow.
// Banners wait for a pause in his playing (never mid-passage, Karen 13318).

export type AdviceRule = 'speed';

/** Fewest milliseconds between two banners. */
export const ADVICE_GAP_MS = 5 * 60_000;
/** No note for this long counts as a pause, when a waiting banner may show. */
export const ADVICE_PAUSE_MS = 4000;
/** A waiting banner older than this is dropped (he has moved on). */
export const ADVICE_STALE_MS = 2 * 60_000;

/** Rule -> the day he said "Not today" to it. */
export type AdviceQuiet = Partial<Record<AdviceRule, string>>;

/** May `rule` show a banner now? */
export function mayOffer(rule: AdviceRule, now: number, day: string, lastShownAt: number | null, quiet: AdviceQuiet): boolean {
  if (quiet[rule] === day) return false;
  return lastShownAt === null || now - lastShownAt >= ADVICE_GAP_MS;
}

/** The quiet list after "Not today" on `rule`; other days' entries drop out. */
export function quietToday(quiet: AdviceQuiet, rule: AdviceRule, day: string): AdviceQuiet {
  const next: AdviceQuiet = {};
  for (const [r, d] of Object.entries(quiet) as [AdviceRule, string][]) if (d === day) next[r] = d;
  next[rule] = day;
  return next;
}
