import type { LayoutSystem } from './review';

export interface DigitalBar {
  measure: number;
  x: number;
  w: number;
  staves: { y0: number; y1: number }[];
  /** #5729: width of the clef / key / time at the bar's start (a line's first bar). */
  head?: number;
  /** #5729: left edge of the bar's first note or rest. */
  note?: number;
}

/**
 * #5729: the first column with ink at or after `from`, once at least `gap` empty columns have gone
 * by: the first note after the key's last accidental. `ink` counts dark pixels per crop column,
 * staff lines left out; a column with under 2 is empty (specks).
 */
export function firstInkAfterGap(ink: ArrayLike<number>, from: number, to: number, gap: number): number | null {
  let empty = 0;
  for (let x = Math.max(0, Math.round(from)); x < Math.min(ink.length, to); x++) {
    if (ink[x] < 2) empty++;
    else if (empty >= gap) return x;
    else empty = 0;
  }
  return null;
}

export interface StaffFit {
  staff: number; // 1-based
  clip: { x: number; y: number; w: number; h: number }; // Crop px
  sx: number;
  sy: number;
  tx: number;
  ty: number;
}

export type BarFit =
  | { measure: number; ok: true; fits: StaffFit[] }
  | { measure: number; ok: false; reason: string };

export function alignBar(
  system: LayoutSystem,
  cropScale: number,
  cropHeight: number,
  measure: number,
  digital: DigitalBar | undefined,
  ink?: ArrayLike<number>,
): BarFit {
  const fail = (reason: string): BarFit => ({ measure, ok: false, reason });

  if (system.measures === null) {
    return fail('this line isn\'t matched to the score');
  }

  const i = measure - system.measures[0];
  if (i < 0 || i >= system.bars || system.barlines.length !== system.bars + 1) {
    return fail('the scan\'s bar lines don\'t match the score here');
  }

  if (digital === undefined || digital.w <= 0) {
    return fail('the score didn\'t draw this bar');
  }

  if (digital.staves.length !== system.staves.length) {
    return fail('the scan and the score have a different number of staves here');
  }

  const scanStaves = system.staves.map((lines) => ({
    top: (Math.min(...lines) - system.y0) * cropScale,
    bottom: (Math.max(...lines) - system.y0) * cropScale,
  }));

  // Check every staff before considering the scale limits.
  const missingLines = scanStaves.some((scan, k) =>
    system.staves[k].length < 2 ||
    scan.bottom === scan.top ||
    digital.staves[k].y1 === digital.staves[k].y0,
  );
  if (missingLines) {
    return fail('a staff\'s lines are missing in the scan');
  }

  const x0 = system.barlines[i] * cropScale;
  const x1 = system.barlines[i + 1] * cropScale;
  const sx = (x1 - x0) / digital.w;

  const fits: StaffFit[] = scanStaves.flatMap((scan, k) => {
    const staff = digital.staves[k];
    const sy = (scan.bottom - scan.top) / (staff.y1 - staff.y0);
    const ty = scan.top - staff.y0 * sy;
    // Stop at the midpoint between staves on BOTH sides: the score's own gap differs from the
    // scan's, so its neighbouring staff would otherwise show through this staff's window.
    const prev = digital.staves[k - 1];
    const next = digital.staves[k + 1];
    const top = k === 0 ? 0 : Math.max((scanStaves[k - 1].bottom + scan.top) / 2, ((prev.y1 + staff.y0) / 2) * sy + ty);
    const bottom = k === scanStaves.length - 1
      ? cropHeight
      : Math.min((scan.bottom + scanStaves[k + 1].top) / 2, ((staff.y1 + next.y0) / 2) * sy + ty);

    const whole = { staff: k + 1, clip: { x: x0, y: top, w: x1 - x0, h: bottom - top }, sx, sy, tx: x0 - digital.x * sx, ty };
    // #5729: a line's first bar opens with clef and key. Their size follows the staff, not the
    // bar's width, so they're fitted at the staff's scale; only the notes after them stretch. The
    // print leaves its own room before the first note, so that note goes on the scan's first ink
    // after the key, looked for within 4 spaces; where the scan is too busy to tell, 1.7 spaces
    // later than the score's own spacing (what the clear lines of Sorcerer's Apprentice show).
    const space = (staff.y1 - staff.y0) / 4;
    const scanSpace = (scan.bottom - scan.top) / 4;
    const head = digital.head ?? 0;
    const note = digital.note;
    if (head < 2 * space || note === undefined || note <= digital.x || note >= digital.x + digital.w) return [whole];
    const lead = (note - digital.x) * sy;
    if (lead >= (x1 - x0) * 0.75) return [whole];
    const found = ink ? firstInkAfterGap(ink, x0 + lead * 0.85, x0 + lead + 4 * scanSpace, 0.5 * scanSpace) : null;
    const scanNote = found ?? x0 + lead + 1.7 * scanSpace;
    const split = Math.min(x0 + lead, scanNote);
    const bodySx = (x1 - scanNote) / (digital.x + digital.w - note);
    if (!(bodySx >= 0.33 && bodySx <= 3)) return [whole];
    return [
      { ...whole, clip: { ...whole.clip, w: split - x0 }, sx: sy, tx: x0 - digital.x * sy },
      { ...whole, clip: { ...whole.clip, x: split, w: x1 - split }, sx: bodySx, tx: scanNote - note * bodySx },
    ];
  });

  if (fits.some((fit) => !(fit.sx >= 0.33 && fit.sx <= 3 && fit.sy >= 0.33 && fit.sy <= 3))) {
    return fail('the bar is too differently shaped to lay one over the other');
  }

  return { measure, ok: true, fits };
}

function ordinal(value: number): string {
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${value}th`;

  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

export function pageLineBar(
  layout: { systems: LayoutSystem[]; pages?: { file: string }[] },
  systemIndex: number,
  measure: number,
): { page: number; line: number; bar: number; label: string } | null {
  const pos = layout.systems.findIndex((system) => system.index === systemIndex);
  if (pos < 0) return null;

  const system = layout.systems[pos];
  if (system.measures === null || measure < system.measures[0] || measure > system.measures[1]) {
    return null;
  }

  const pagePos = layout.pages?.findIndex((page) => page.file === system.page) ?? -1;
  const page = pagePos >= 0
    ? pagePos + 1
    : [...new Set(layout.systems.map((entry) => entry.page))].indexOf(system.page) + 1;
  const line = layout.systems.slice(0, pos + 1).filter((entry) => entry.page === system.page).length;
  const bar = measure - system.measures[0] + 1;

  return {
    page,
    line,
    bar,
    label: `Page ${page}, line ${line}, ${ordinal(bar)} bar`,
  };
}

export function stepBar(
  systems: LayoutSystem[],
  linePos: number,
  barPos: number,
  dir: 1 | -1,
): { linePos: number; barPos: number } | null {
  if (!Number.isInteger(linePos) || linePos < 0 || linePos >= systems.length) {
    return null;
  }

  const nextBar = barPos + dir;
  if (nextBar >= 0 && nextBar < systems[linePos].bars) {
    return { linePos, barPos: nextBar };
  }

  for (let nextLine = linePos + dir; nextLine >= 0 && nextLine < systems.length; nextLine += dir) {
    const bars = systems[nextLine].bars;
    if (bars < 1) continue;

    return {
      linePos: nextLine,
      barPos: dir === 1 ? 0 : bars - 1,
    };
  }

  return null;
}
