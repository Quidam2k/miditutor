import type { Span } from './TroubleSpots';
import type { SpeedAdvice } from './SpeedMisses';

// #6530 E: the tutor's own advice, one banner at a time.
// At most one banner every 5 minutes; "Not today" quiets that rule until tomorrow.
// Banners wait for a pause in his playing (never mid-passage, Karen 13318).

export type AdviceRule = 'speed' | 'spotBack' | 'reshape' | 'worse' | 'pause' | 'velocity';

/** Fewest milliseconds between two banners. */
export const ADVICE_GAP_MS = 5 * 60_000;
/** No note for this long counts as a pause, when a waiting banner may show. */
export const ADVICE_PAUSE_MS = 4000;
/** A waiting banner older than this is dropped (he has moved on). */
export const ADVICE_STALE_MS = 2 * 60_000;

/** Rule -> the day he said "Not today" to it. */
export type AdviceQuiet = Partial<Record<AdviceRule, string>>;

/** Has it been long enough since the last banner? */
export function gapOpen(now: number, lastShownAt: number | null): boolean {
  return lastShownAt === null || now - lastShownAt >= ADVICE_GAP_MS;
}

/** May `rule` show a banner now? */
export function mayOffer(rule: AdviceRule, now: number, day: string, lastShownAt: number | null, quiet: AdviceQuiet): boolean {
  if (quiet[rule] === day) return false;
  return gapOpen(now, lastShownAt);
}

/** The quiet list after "Not today" on `rule`; other days' entries drop out. */
export function quietToday(quiet: AdviceQuiet, rule: AdviceRule, day: string): AdviceQuiet {
  const next: AdviceQuiet = {};
  for (const [r, d] of Object.entries(quiet) as [AdviceRule, string][]) if (d === day) next[r] = d;
  next[rule] = day;
  return next;
}

/** What the banner's one button does. */
export type AdviceAction =
  | { kind: 'slower'; bpm: number }
  | { kind: 'loop'; span: Span }
  | { kind: 'reshape'; windows: Span[] };

/** One banner: the rule it came from, its words, its button, and the numbers behind it (for the log). */
export interface AdviceCard {
  rule: AdviceRule;
  text: string;
  sub?: string;
  action?: AdviceAction;
  data?: Record<string, unknown>;
}

const bars = (s: Span) => (s.first === s.last ? `bar ${s.first}` : `${s.first}-${s.last}`);
const barsWord = (s: Span) => (s.first === s.last ? `bar ${s.first}` : `bars ${s.first}-${s.last}`);
const list = (items: string[]) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/** The button's words. */
export function actionLabel(a: AdviceAction): string {
  if (a.kind === 'slower') return 'Play it slower';
  if (a.kind === 'reshape') return 'Use these';
  return `Loop ${barsWord(a.span)}`;
}

export function reshapeCard(clean: Span[], windows: Span[]): AdviceCard {
  const cleanText = list(clean.map(barsWord));
  const n = windows.length;
  const size = windows.every((w) => w.last - w.first === windows[0].last - windows[0].first)
    ? `${windows[0].last - windows[0].first + 1}-bar ` : '';
  const count = n === 1 ? 'one' : n === 2 ? 'two' : 'three';
  const loops = n === 1 ? `a ${size}loop at ${bars(windows[0])}` : `${count} ${size}loops at ${list(windows.map(bars))}`;
  return {
    rule: 'reshape',
    text: `${cleanText[0].toUpperCase()}${cleanText.slice(1)} are clean: try ${loops}.`,
    sub: 'They go on your trouble-spot list; the first one starts now.',
    action: { kind: 'reshape', windows },
    data: { clean, windows },
  };
}

export function pauseCard(bar: number, times: number, loopFirst: number): AdviceCard {
  const span = { first: Math.max(loopFirst, bar - 1), last: bar };
  return {
    rule: 'pause',
    text: `You pause before bar ${bar} every time. Loop ${barsWord(span)}?`,
    sub: 'Playing across the join is what makes it smooth.',
    action: { kind: 'loop', span },
    data: { bar, times },
  };
}

export function worseCard(now: number, best: number, windows: Span[]): AdviceCard {
  return {
    rule: 'worse',
    text: `This pass had ${now} wrong; your best this week had ${best}. The new trouble is at ${list(windows.map(barsWord))}.`,
    action: { kind: 'loop', span: windows[0] },
    data: { now, best, windows },
  };
}

export function velocityCard(name: string, bar: number, ratio: number, laps: number, hand: 'L' | 'R'): AdviceCard {
  return {
    rule: 'velocity',
    text: `The ${name} in bar ${bar} (${hand === 'L' ? 'left' : 'right'} hand) keeps coming out quieter than the notes around it (about ${Math.round(ratio * 100)}% as loud).`,
    data: { name, bar, ratio, laps, hand },
  };
}

export function spotBackCard(spot: Span, daysAgo: number, misses: number): AdviceCard {
  const when = daysAgo <= 1 ? 'yesterday' : `${daysAgo} days ago`;
  return {
    rule: 'spotBack',
    text: `${barsWord(spot).replace(/^b/, 'B')} came off your list ${when}; the misses are back (${misses} today).`,
    action: { kind: 'loop', span: { first: spot.first, last: spot.last } },
    data: { first: spot.first, last: spot.last, daysAgo, misses },
  };
}

export function speedCard(speed: SpeedAdvice, slow: number[]): AdviceCard {
  return {
    rule: 'speed',
    text: `You miss more above ♩ = ${speed.above}. Try the whole piece at ♩ = ${speed.tryBpm} with a click?`,
    ...(slow.length ? { sub: `You slow down most at ${slow.length === 1 ? 'bar' : 'bars'} ${slow.join(', ')}.` } : {}),
    action: { kind: 'slower', bpm: speed.tryBpm },
    data: { ...speed, why: speed.rule, slowBars: slow },
  };
}
