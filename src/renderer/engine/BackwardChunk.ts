// #10133: practice a section backwards. The loop starts on the last bar; after enough
// clean laps (no wrong note in the lap) it steps back one bar, until it covers the
// whole section. Todd's words (msg 52142): three times properly, then add the bar
// before and do those five times. A lap with a wrong note just doesn't count; it
// never takes away clean laps or shrinks the chunk.

export interface ChunkState {
  first: number; // the section's first bar
  last: number; // the section's last bar
  start: number; // the chunk's first bar (the loop runs start..last)
  clean: number; // clean laps on this chunk
  need: number; // clean laps it takes to grow
  done: boolean; // the chunk covers the whole section and has its clean laps
}

/** "3,5" -> [3, 5]. Empty or invalid input gives the default. */
export function parseTargets(text: string): number[] {
  const out = text
    .split(/[\s,]+/)
    .map((t) => Math.trunc(Number(t)))
    .filter((n) => Number.isFinite(n) && n >= 1);
  return out.length ? out : [3, 5];
}

/** Clean laps chunk k needs (k = 0 is the last bar alone); the list's last value repeats. */
export function targetFor(targets: number[], k: number): number {
  return targets[Math.min(Math.max(0, k), targets.length - 1)];
}

export function startChunk(first: number, last: number, targets: number[]): ChunkState {
  const a = Math.min(first, last);
  const b = Math.max(first, last);
  return { first: a, last: b, start: b, clean: 0, need: targetFor(targets, 0), done: false };
}

/**
 * One lap finished. Returns the new state and whether the chunk grew a bar. The target
 * comes from `targets` now, so an edit to it applies to the chunk he is on.
 */
export function lapDone(s: ChunkState, wrongInLap: number, targets: number[]): { state: ChunkState; grew: boolean } {
  if (wrongInLap > 0) return { state: s, grew: false };
  const clean = s.clean + 1;
  const need = targetFor(targets, s.last - s.start);
  if (s.done || clean < need) return { state: { ...s, clean, need }, grew: false };
  if (s.start <= s.first) return { state: { ...s, clean, need, done: true }, grew: false };
  const start = s.start - 1;
  return { state: { ...s, start, clean: 0, need: targetFor(targets, s.last - start) }, grew: true };
}

/**
 * #10236: he typed a new overall range. A new first bar keeps his progress (the chunk only
 * moves if it now starts before the range does). A new last bar is music he hasn't built
 * yet, so it starts over from there.
 */
export function rangeEdited(s: ChunkState, first: number, last: number, targets: number[]): ChunkState {
  if (last !== s.last) return startChunk(first, last, targets);
  if (s.start >= first) return { ...s, first, done: s.done && s.start === first };
  return { ...s, first, start: first, clean: 0, need: targetFor(targets, last - first), done: false };
}

/** The status line: "Backwards: bars 33–35 · clean 2/5", or the whole-range tally. */
export function chunkLabel(s: ChunkState): string {
  if (s.done) return `Backwards: whole range ${s.first}–${s.last} · ${s.clean} clean laps`;
  const bars = s.start === s.last ? `bar ${s.last}` : `bars ${s.start}–${s.last}`;
  return `Backwards: ${bars} · clean ${s.clean}/${s.need}`;
}
