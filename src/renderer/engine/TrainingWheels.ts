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
