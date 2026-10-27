// Scan review (#9664): the review store is an append-only event log per piece
// (library/review/<slug>.events.jsonl). Both UIs only append events; everything
// shown (open marks, confirmed lines, "Verified by you") is a fold of the log.
// Pure: no fs, no Electron. The desk app is the only writer of the log.

/** One printed system, from scripts/review_layout.py (full-res deskewed page px). */
export interface LayoutSystem {
  index: number;
  page: string;
  y0: number;
  y1: number;
  spacing: number;
  staves: number[][];
  x_left: number;
  x_right: number;
  /** Both system ends and every barline between, left to right: bars = length - 1. */
  barlines: number[];
  bars: number;
  /** One-based measure positions in the score, or null when the scan and the XML disagree here. */
  measures: [number, number] | null;
  numbers: [string, string] | null;
  crop: string;
}

export interface Layout {
  version: 1;
  slug: string;
  score: string;
  score_sha256: string;
  crop_scale: number;
  xml: { measures: number; breaks: number[]; staves_per_system: number };
  scan: { bars: number; systems: number };
  match: 'exact' | 'partial' | 'none';
  systems: LayoutSystem[];
}

export type Origin = 'solace' | 'pinocchio';

/** A circle he drew, in the coordinates of the side he drew it on (scan = crop px). */
export interface Circle {
  side: 'scan' | 'score';
  cx: number;
  cy: number;
  r: number;
}

interface EventBase {
  id: string;
  origin: Origin;
  ts: number;
}

export type ReviewEvent = EventBase & (
  | { kind: 'mark'; system: number; measure: number | null; staff?: number | null; note?: string; circle?: Circle }
  /** "This line matches", against the score file as it was then. */
  | { kind: 'confirm_system'; system: number; sha: string }
  /** A proposal applied: the score went from `before` to `after`. */
  | { kind: 'accept'; mark: string; before: string; after: string; proposal: string }
  /** "Still wrong": the mark stays open and is re-checked with his note. */
  | { kind: 'reject'; mark: string; note?: string }
  /** He withdrew the mark (it was fine after all). */
  | { kind: 'withdraw'; mark: string }
);

export type MarkStatus = 'open' | 'applied' | 'withdrawn';

export interface MarkState {
  id: string;
  system: number;
  measure: number | null;
  staff: number | null;
  note: string;
  circle?: Circle;
  origin: Origin;
  ts: number;
  status: MarkStatus;
  /** Each "still wrong" note, oldest first; the re-check sees them all. */
  rejections: string[];
}

export interface ReviewState {
  marks: MarkState[];
  /** System index -> when he confirmed it (only confirms that still stand). */
  confirmed: Record<number, number>;
  /** The score changed outside review since some confirms: those were dropped. */
  externalChange: boolean;
  verified: boolean;
}

/** Log order: time, then id, so both origins fold the same way. Duplicate ids keep the first. */
export function orderEvents(events: ReviewEvent[]): ReviewEvent[] {
  const seen = new Set<string>();
  const unique = events.filter((e) => !seen.has(e.id) && seen.add(e.id));
  return unique.sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Fold the log against the score as it is now (`currentSha`).
 * A confirm stands only while nothing on that system came after it (a mark or an
 * applied fix) and the score only changed through review since. Any other change
 * to the score (a re-ingest) drops every confirm. Verified = every system mapped
 * and confirmed, and no mark open.
 */
export function foldReview(events: ReviewEvent[], layout: Layout | null, currentSha: string): ReviewState {
  const marks = new Map<string, MarkState>();
  let confirmed: Record<number, number> = {};
  let externalChange = false;
  // The score file as review last knew it; undefined until an event pins it.
  let lineage: string | undefined;
  const pin = (sha: string) => {
    if (lineage !== undefined && sha !== lineage) {
      confirmed = {};
      externalChange = true;
    }
  };

  for (const e of orderEvents(events)) {
    switch (e.kind) {
      case 'mark':
        marks.set(e.id, {
          id: e.id, system: e.system, measure: e.measure, staff: e.staff ?? null, note: e.note ?? '',
          circle: e.circle, origin: e.origin, ts: e.ts, status: 'open', rejections: [],
        });
        delete confirmed[e.system];
        break;
      case 'confirm_system':
        pin(e.sha);
        lineage = e.sha;
        confirmed[e.system] = e.ts;
        break;
      case 'accept': {
        pin(e.before);
        lineage = e.after;
        const mark = marks.get(e.mark);
        if (mark) {
          mark.status = 'applied';
          delete confirmed[mark.system];
        }
        break;
      }
      case 'reject': {
        const mark = marks.get(e.mark);
        if (mark && mark.status === 'open') mark.rejections.push(e.note ?? '');
        break;
      }
      case 'withdraw': {
        const mark = marks.get(e.mark);
        if (mark && mark.status === 'open') mark.status = 'withdrawn';
        break;
      }
    }
  }
  pin(currentSha);

  const list = [...marks.values()];
  const systems = layout?.systems ?? [];
  const verified = layout !== null && layout.match === 'exact' && systems.length > 0 &&
    layout.score_sha256 === currentSha &&
    systems.every((s) => confirmed[s.index] !== undefined) &&
    list.every((m) => m.status !== 'open');
  return { marks: list, confirmed, externalChange, verified };
}

/**
 * The bar under scan x (full-res page px) in a system, as a one-based score
 * position, or null when the system is unmapped or x is outside its bars.
 */
export function measureAtX(system: LayoutSystem, x: number): number | null {
  if (!system.measures) return null;
  const edges = system.barlines;
  for (let i = 0; i + 1 < edges.length; i++) {
    if (x >= edges[i] && x < edges[i + 1]) return system.measures[0] + i;
  }
  return null;
}

/** The system holding a one-based score position, or undefined. */
export function systemOfMeasure(layout: Layout, measure: number): LayoutSystem | undefined {
  return layout.systems.find((s) => s.measures && measure >= s.measures[0] && measure <= s.measures[1]);
}
