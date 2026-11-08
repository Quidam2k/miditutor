// #5519: keyboard training wheels. The green "play me" keys show for the first bar of a
// lap, then fade so his eyes go to the notes; they come back on a hesitation.

/** Gaps between step advances (ms) worth remembering for his pace. */
export const PACE_SAMPLES = 8;
/** Never call a pause shorter than this a hesitation. */
export const MIN_HESITATION_MS = 1200;

/** How long without a credited note counts as hesitating: twice his recent step pace. */
export function hesitationMs(gaps: readonly number[]): number {
  const recent = gaps.slice(-PACE_SAMPLES).filter((g) => g > 0).sort((a, b) => a - b);
  if (!recent.length) return MIN_HESITATION_MS;
  const mid = recent.length >> 1;
  const median = recent.length % 2 ? recent[mid] : (recent[mid - 1] + recent[mid]) / 2;
  return Math.max(MIN_HESITATION_MS, 2 * median);
}

// #11354 item 3 (JP doc 11/6, lesson 11/6 "I will embrace it"): five minutes with every hint off
// on the piece he's on. It counts the bars he gets through without a miss, and his misses.

export const BARE_MS = 5 * 60_000;

export interface BareRun {
  pieceId: string;
  endsAt: number;
  /** The bar he's in now (null before his first note and after a lap ends). */
  bar: number | null;
  barMissed: boolean;
  cleared: number;
  misses: number;
}

export function startBare(pieceId: string, now: number): BareRun {
  return { pieceId, endsAt: now + BARE_MS, bar: null, barMissed: false, cleared: 0, misses: 0 };
}

/** A credited note in `bar`: leaving a bar with no miss in it clears that bar. */
export function bareNote(run: BareRun, bar: number): BareRun {
  if (run.bar === bar) return run;
  return { ...closeBar(run), bar, barMissed: false };
}

/** A miss on a note of `bar` (it may be the first note of a bar he just reached). */
export function bareMiss(run: BareRun, bar: number): BareRun {
  return { ...bareNote(run, bar), misses: run.misses + 1, barMissed: true };
}

/** The lap or the piece ended: the bar he finished in counts too. */
export function closeBar(run: BareRun): BareRun {
  const cleared = run.bar !== null && !run.barMissed ? run.cleared + 1 : run.cleared;
  return { ...run, bar: null, barMissed: false, cleared };
}
