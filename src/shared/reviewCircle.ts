// What a circle he drew covers (#9764): the bars under it (one mark per bar) and
// the notes inside it, so a mark keeps what he circled instead of the whole bar.

/** A bar's sideways extent on one side (scan crop px, or the OSMD svg frame). */
export interface BarSpan {
  measure: number;
  x0: number;
  x1: number;
}

/** A drawn note on the score side, in the OSMD svg frame. */
export interface NoteBox {
  measure: number;
  staff: number;
  x: number;
  y: number;
  /** "E3", "F#4", "Bb2". */
  name: string;
  /** 1-based beat within the bar, in the time signature's beat unit. */
  beat: number;
}

/** A circled note as a mark stores it. */
export interface MarkNote {
  name: string;
  beat: number;
  staff: number;
}

// A circle that only grazes the next bar (its edge crossing the bar line) doesn't mark that bar.
const MIN_SHARE = 0.2;

/**
 * Bars a circle covers, left to right. A bar counts when the circle's sideways span
 * covers at least a fifth of the circle's width inside it; if none does (a tiny
 * circle on a bar line), the bar with the most overlap. Outside every bar -> [].
 */
export function barsUnder(bars: BarSpan[], cx: number, r: number): number[] {
  const width = Math.max(2 * r, 1e-6);
  const overlap = (b: BarSpan) => Math.min(cx + r, b.x1) - Math.max(cx - r, b.x0);
  const touched = bars.filter((b) => overlap(b) > 0).sort((a, b) => a.x0 - b.x0);
  if (touched.length === 0) return [];
  const covered = touched.filter((b) => overlap(b) / width >= MIN_SHARE);
  if (covered.length) return covered.map((b) => b.measure);
  return [touched.reduce((best, b) => (overlap(b) > overlap(best) ? b : best)).measure];
}

/** Score side: the notes of this bar whose heads sit inside the circle. */
export function notesInCircle(notes: NoteBox[], measure: number, c: { cx: number; cy: number; r: number }): NoteBox[] {
  return notes.filter((n) => n.measure === measure && Math.hypot(n.x - c.cx, n.y - c.cy) <= c.r);
}

/**
 * Scan side: the circle's sideways span as a share (0..1) of the scan bar, applied to
 * the same bar on the score; `staff` null means both staves.
 */
export function notesInShare(
  notes: NoteBox[], measure: number, staff: number | null, bar: { x: number; w: number }, f0: number, f1: number,
): NoteBox[] {
  const [lo, hi] = [bar.x + Math.max(0, f0) * bar.w, bar.x + Math.min(1, f1) * bar.w];
  return notes.filter((n) => n.measure === measure && (staff === null || n.staff === staff) && n.x >= lo && n.x <= hi);
}

/** For the event: name, beat, staff, in time order then low to high. */
export function markNotes(notes: NoteBox[]): MarkNote[] {
  return [...notes]
    .sort((a, b) => a.beat - b.beat || b.staff - a.staff || b.y - a.y)
    .map((n) => ({ name: n.name, beat: n.beat, staff: n.staff }));
}

const beatWord = (b: number) => `beat ${Number.isInteger(b) ? b : b.toFixed(2).replace(/0+$/, '')}`;

/** "E3 G3 (beat 2), C4 (beat 2.5)": what he circled, as the marks list shows it. */
export function describeNotes(notes: MarkNote[]): string {
  const groups: { beat: number; names: string[] }[] = [];
  for (const n of notes) {
    const last = groups[groups.length - 1];
    if (last && last.beat === n.beat) last.names.push(n.name);
    else groups.push({ beat: n.beat, names: [n.name] });
  }
  return groups.map((g) => `${g.names.join(' ')} (${beatWord(g.beat)})`).join(', ');
}
