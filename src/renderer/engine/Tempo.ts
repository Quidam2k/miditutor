// #6530 phase B: the tempo a score asks for, and how fast he actually played a stretch.

/** Quarter notes per beat-unit (MusicXML <beat-unit> names). */
const QUARTERS: Record<string, number> = {
  whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25,
};

/**
 * The first tempo the score marks, in quarter notes per minute, or null.
 * <sound tempo> is always in quarters; a bare <metronome> mark is converted from its beat unit.
 */
export function markedTempo(xml: string): number | null {
  const sound = /<sound\b[^>]*\btempo="([\d.]+)"/.exec(xml);
  if (sound) {
    const bpm = Math.round(Number(sound[1]));
    if (bpm > 0) return bpm;
  }
  const mark = /<metronome\b[^>]*>([\s\S]*?)<\/metronome>/.exec(xml);
  if (!mark) return null;
  const unit = /<beat-unit>\s*([\w]+)\s*<\/beat-unit>/.exec(mark[1])?.[1];
  const per = Number(/<per-minute>\s*([\d.]+)/.exec(mark[1])?.[1]);
  const quarters = unit ? QUARTERS[unit] : undefined;
  if (!quarters || !(per > 0)) return null;
  const dotted = /<beat-unit-dot\s*\/>/.test(mark[1]) ? 1.5 : 1;
  return Math.round(per * quarters * dotted);
}

/** Average tempo (quarters per minute) over `beats` quarter beats played in `ms`; null if unmeasurable. */
export function playedTempo(beats: number, ms: number): number | null {
  return beats > 0 && ms > 0 ? Math.round(beats / (ms / 60000)) : null;
}
