import { clusterWindows, type Span } from './TroubleSpots';
import type { Spot } from './TroubleSpots';

export interface Run {
  first: number;
  last: number;
  wrong: number;
  wrongBars: number[];
  at: number;
}

export interface VelSample {
  step: number;
  note: number;
  hand: 'L' | 'R';
  velocity: number;
  lap: number;
}

export interface VelOutlier {
  step: number;
  note: number;
  hand: 'L' | 'R';
  ratio: number;
  laps: number;
}

function spanLength(s: Span): number {
  return s.last - s.first + 1;
}

export function loopReshape(
  laps: number[][],
  loop: Span,
): { clean: Span[]; windows: Span[] } | null {
  const total = spanLength(loop);
  if (laps.length < 3 || total < 8) return null;

  const weightByBar = new Map<number, number>();
  for (const lap of laps) {
    for (const bar of new Set(lap)) {
      if (bar < loop.first || bar > loop.last) continue;
      weightByBar.set(bar, (weightByBar.get(bar) ?? 0) + 1);
    }
  }

  const weights: { bar: number; weight: number }[] = [];
  for (let bar = loop.first; bar <= loop.last; bar++) {
    const weight = weightByBar.get(bar) ?? 0;
    if (weight > 0) weights.push({ bar, weight });
  }

  const windows = clusterWindows(weights, loop).slice(0, 3);
  if (windows.length < 1) return null;

  const clean: Span[] = [];
  let runStart: number | null = null;
  for (let bar = loop.first; bar <= loop.last + 1; bar++) {
    const isClean = bar <= loop.last && (weightByBar.get(bar) ?? 0) === 0;
    if (isClean) {
      if (runStart === null) runStart = bar;
    } else if (runStart !== null) {
      if (bar - runStart >= 2) clean.push({ first: runStart, last: bar - 1 });
      runStart = null;
    }
  }

  const cleanBars = clean.reduce((sum, s) => sum + spanLength(s), 0);
  const windowBars = windows.reduce((sum, s) => sum + spanLength(s), 0);
  if (cleanBars * 10 < total * 4) return null;
  if (windowBars * 10 > total * 6) return null;

  return { clean, windows };
}

export function pauseBefore(
  entries: Map<number, boolean[]>,
): { bar: number; times: number } | null {
  let best: { bar: number; times: number } | null = null;
  for (const [bar, list] of entries) {
    if (list.length < 3) continue;
    let times = 0;
    for (let i = list.length - 1; i >= 0 && list[i] === true; i--) times++;
    if (times < 3) continue;
    if (
      best === null ||
      times > best.times ||
      (times === best.times && bar < best.bar)
    ) {
      best = { bar, times };
    }
  }
  return best;
}

export function worseThanBest(
  current: Run,
  others: Run[],
): { best: number; now: number; windows: Span[] } | null {
  const eligible = others.filter(
    (o) =>
      o.first === current.first && o.last === current.last && o.at !== current.at,
  );
  if (eligible.length < 2) return null;

  let best: Run | null = null;
  for (const o of eligible) {
    if (
      best === null ||
      o.wrong < best.wrong ||
      (o.wrong === best.wrong && o.at > best.at)
    ) {
      best = o;
    }
  }
  if (best === null) return null;
  if (current.wrong < best.wrong + 3) return null;

  const bestBars = new Set(best.wrongBars);
  const counts = new Map<number, number>();
  for (const bar of current.wrongBars) {
    if (bestBars.has(bar)) continue;
    counts.set(bar, (counts.get(bar) ?? 0) + 1);
  }
  const weights: { bar: number; weight: number }[] = [];
  for (const [bar, weight] of counts) weights.push({ bar, weight });

  const windows = clusterWindows(weights, {
    first: current.first,
    last: current.last,
  }).slice(0, 2);
  if (windows.length === 0) return null;

  return { best: best.wrong, now: current.wrong, windows };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid] ?? 0;
  if (sorted.length % 2 === 1) return hi;
  const lo = sorted[mid - 1] ?? hi;
  return (lo + hi) / 2;
}

export function velocityOutlier(samples: VelSample[]): VelOutlier | null {
  // lap -> key -> last sample
  const byLap = new Map<number, Map<string, VelSample>>();
  for (const s of samples) {
    let lapMap = byLap.get(s.lap);
    if (lapMap === undefined) {
      lapMap = new Map<string, VelSample>();
      byLap.set(s.lap, lapMap);
    }
    lapMap.set(`${s.step}:${s.note}`, s);
  }

  const stats = new Map<
    string,
    { step: number; note: number; hand: 'L' | 'R'; ratios: number[]; quiet: number }
  >();

  for (const lapMap of byLap.values()) {
    const lapSamples = [...lapMap.values()];
    for (const s of lapSamples) {
      const neighbours = lapSamples.filter(
        (n) =>
          n !== s &&
          n.hand === s.hand &&
          n.step !== s.step &&
          Math.abs(n.step - s.step) <= 2,
      );
      if (neighbours.length < 2) continue;
      const mean =
        neighbours.reduce((sum, n) => sum + n.velocity, 0) / neighbours.length;
      if (mean < 30) continue;

      const key = `${s.step}:${s.note}`;
      let st = stats.get(key);
      if (st === undefined) {
        st = { step: s.step, note: s.note, hand: s.hand, ratios: [], quiet: 0 };
        stats.set(key, st);
      }
      st.hand = s.hand;
      st.ratios.push(s.velocity / mean);
      if (s.velocity < 0.8 * mean) st.quiet++;
    }
  }

  let best: VelOutlier | null = null;
  for (const st of stats.values()) {
    const judged = st.ratios.length;
    if (judged < 3) continue;
    if (st.quiet * 4 < judged * 3) continue;
    const ratio = Math.round(median(st.ratios) * 100) / 100;
    const cand: VelOutlier = {
      step: st.step,
      note: st.note,
      hand: st.hand,
      ratio,
      laps: judged,
    };
    if (
      best === null ||
      cand.ratio < best.ratio ||
      (cand.ratio === best.ratio &&
        (cand.step < best.step ||
          (cand.step === best.step && cand.note < best.note)))
    ) {
      best = cand;
    }
  }
  return best;
}

function utcDay(date: string): number {
  const parts = date.split('-').map((p) => Number(p));
  const y = parts[0] ?? NaN;
  const m = parts[1] ?? NaN;
  const d = parts[2] ?? NaN;
  return Date.UTC(y, m - 1, d);
}

export function spotBack(
  spots: Spot[],
  missesByBar: Map<number, number>,
  today: string,
): { spot: Spot; misses: number; daysAgo: number } | null {
  let best: { spot: Spot; misses: number; daysAgo: number } | null = null;
  for (const spot of spots) {
    const ticked = spot.ticked;
    if (ticked === undefined || !(ticked < today)) continue;

    let misses = 0;
    for (let bar = spot.first; bar <= spot.last; bar++) {
      misses += missesByBar.get(bar) ?? 0;
    }
    if (misses < 3) continue;

    const daysAgo = Math.round((utcDay(today) - utcDay(ticked)) / 86400000);
    if (Number.isNaN(daysAgo)) continue;

    if (
      best === null ||
      misses > best.misses ||
      (misses === best.misses && spot.first < best.spot.first)
    ) {
      best = { spot, misses, daysAgo };
    }
  }
  return best;
}
