// #10262 Sight-read: which piece, hand and bars to drill from his library. Pure logic; never touches a score.
// simple = he marked it; drilled = how many times sight-read has picked it; trusted = false when the OMR audit found issues.
export interface SightCandidate { id: string; label: string; xml: string; simple: boolean; favorite: boolean; drilled: number; trusted: boolean }

const MIN_BARS = 5;
const MAX_EXTRA_BARS = 4; // length is 5..8

/** Sounding notes per bar (rests and grace notes skipped); 0 when the file has no bars. */
export function notesPerBar(xml: string): number {
  const bars = (xml.match(/<measure[\s>]/g) ?? []).length;
  if (bars === 0) return 0;
  const notes = (xml.match(/<note[\s>][\s\S]*?<\/note>/g) ?? []).filter((n) => !/<rest|<grace/.test(n)).length;
  return notes / bars;
}

/** Staves in the first <staves>N</staves>; 1 when absent. */
export function staffCountOf(xml: string): number {
  const m = /<staves>\s*(\d+)\s*<\/staves>/.exec(xml);
  return m ? Number(m[1]) : 1;
}

const pickOne = <T>(xs: T[], rand: () => number): T => xs[Math.min(Math.floor(rand() * xs.length), xs.length - 1)];

/** Piece to sight-read: his simple ones first, else the easiest third of the rest; least-drilled wins, one rand() call. */
export function pickSightPiece(cands: SightCandidate[], rand: () => number = Math.random): SightCandidate | null {
  const all = cands.filter((c) => c.xml.length > 0);
  if (all.length === 0) return null;
  const nonFav = all.filter((c) => !c.favorite);
  let tier = nonFav.filter((c) => c.simple);
  if (tier.length === 0) {
    const sorted = nonFav
      .filter((c) => c.trusted)
      .map((c) => ({ c, n: notesPerBar(c.xml) }))
      .sort((a, b) => a.n - b.n || (a.c.id < b.c.id ? -1 : a.c.id > b.c.id ? 1 : 0));
    tier = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 3))).map((s) => s.c);
  }
  if (tier.length === 0) tier = nonFav;
  if (tier.length === 0) tier = all;
  const least = Math.min(...tier.map((c) => c.drilled));
  return pickOne(tier.filter((c) => c.drilled === least), rand);
}

/** Both hands for a one-staff piece; otherwise one hand, chosen at random. */
export function pickHand(xml: string, rand: () => number = Math.random): 'both' | 'right' | 'left' {
  if (staffCountOf(xml) < 2) return 'both';
  return rand() < 0.5 ? 'right' : 'left';
}

/**
 * A 5..8 bar stretch with at least 5 bars that have notes; stepBars is the bar of each playable step.
 * It always ends on a bar with notes, so a drill never finishes on silence.
 */
export function pickBars(stepBars: number[], rand: () => number = Math.random): { first: number; last: number } | null {
  const bars = [...new Set(stepBars)].sort((a, b) => a - b);
  if (bars.length === 0) return null;
  const length = MIN_BARS + Math.floor(rand() * MAX_EXTRA_BARS);
  const min = bars[0];
  const lastNoteWithin = (to: number) => bars.filter((b) => b <= to).pop() as number;
  if (bars.length < MIN_BARS) return { first: min, last: bars[bars.length - 1] };
  const starts = bars.filter((s) => bars.filter((b) => b >= s && b <= s + length - 1).length >= MIN_BARS);
  if (starts.length === 0) return { first: min, last: lastNoteWithin(min + 7) };
  const s = pickOne(starts, rand);
  return { first: s, last: lastNoteWithin(s + length - 1) };
}
