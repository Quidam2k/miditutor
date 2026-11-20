// Speed vs. misses: decide whether the player misses more at faster tempos.
// A "run" is one loop lap or whole-piece pass with its average tempo and wrong-note count.

export interface Run {
  bpm: number;
  wrong: number;
  firstBar: number;
  lastBar: number;
  at?: number;
}

export interface SpeedAdvice {
  rule: 'halves' | 'overrun';
  first: number; // first bar of the runs judged
  last: number; // last bar of the runs judged
  above: number; // "you miss more above ♩ = above"
  tryBpm: number; // suggested slower tempo
  fastRate: number; // wrong notes per bar, rounded to 0.01
  slowRate: number; // wrong notes per bar, rounded to 0.01
  runs: number; // runs judged
}

/** Fewest runs (in one bar span) needed before we give advice. */
export const MIN_RUNS = 6;

/** Wrong notes per bar for one run; 0 if the run covers less than one bar. */
export function missRate(r: Run): number {
  const bars = r.lastBar - r.firstBar + 1;
  if (!(bars >= 1)) return 0;
  return r.wrong / bars;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function isValid(r: Run): boolean {
  return (
    Number.isFinite(r.bpm) &&
    r.bpm > 0 &&
    Number.isFinite(r.wrong) &&
    r.wrong >= 0 &&
    Number.isFinite(r.firstBar) &&
    Number.isFinite(r.lastBar) &&
    r.lastBar >= r.firstBar
  );
}

/** Highest `at` wins (later input wins ties); if no run has `at`, the last in input order. */
function latestRun(group: Run[]): Run {
  let best = -1;
  for (let i = 0; i < group.length; i++) {
    const at = group[i].at;
    if (at === undefined || !Number.isFinite(at)) continue;
    if (best === -1) {
      best = i;
    } else {
      const bestAt = group[best].at as number;
      if (at >= bestAt) best = i;
    }
  }
  return best === -1 ? group[group.length - 1] : group[best];
}

function latestAtOf(group: Run[]): number {
  let m = -Infinity;
  for (const r of group) {
    if (r.at !== undefined && Number.isFinite(r.at) && r.at > m) m = r.at;
  }
  return m;
}

function pickGroup(
  runs: Run[],
  range?: { first: number; last: number },
): Run[] | null {
  const groups = new Map<string, Run[]>();
  for (const r of runs) {
    const key = `${r.firstBar}-${r.lastBar}`;
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }
  if (range) {
    return groups.get(`${range.first}-${range.last}`) ?? null;
  }
  let best: Run[] | null = null;
  let bestLatest = -Infinity;
  for (const g of groups.values()) {
    const latest = latestAtOf(g);
    if (
      best === null ||
      g.length > best.length ||
      (g.length === best.length && latest > bestLatest)
    ) {
      best = g;
      bestLatest = latest;
    }
  }
  return best;
}

function halvesRule(group: Run[]): SpeedAdvice | null {
  const sorted = [...group].sort((a, b) => a.bpm - b.bpm);
  const n = sorted.length;
  const h = Math.floor(n / 2);
  const slower = sorted.slice(0, h);
  const faster = sorted.slice(n - h);
  const spread =
    median(faster.map((r) => r.bpm)) - median(slower.map((r) => r.bpm));
  if (spread < 4) return null;
  const slowRate = mean(slower.map(missRate));
  const fastRate = mean(faster.map(missRate));
  let fastWrong = 0;
  for (const r of faster) fastWrong += r.wrong;
  if (!(fastRate >= 1.5 * slowRate && fastWrong >= 3 && fastRate > slowRate)) {
    return null;
  }
  const above = Math.round(faster[0].bpm);
  const clean = slower.filter((r) => r.wrong === 0);
  const base = clean.length > 0 ? clean : slower;
  const tryBpm = Math.min(Math.round(median(base.map((r) => r.bpm))), above - 4);
  return {
    rule: 'halves',
    first: group[0].firstBar,
    last: group[0].lastBar,
    above,
    tryBpm,
    fastRate: round2(fastRate),
    slowRate: round2(slowRate),
    runs: n,
  };
}

function overrunRule(group: Run[]): SpeedAdvice | null {
  const clean = group.filter((r) => r.wrong === 0);
  if (clean.length < 2) return null;
  const c = median(clean.map((r) => r.bpm));
  const latest = latestRun(group);
  const rate = missRate(latest);
  const slowRate = mean(group.filter((r) => r.bpm <= 1.05 * c).map(missRate));
  if (!(latest.bpm > 1.1 * c && rate >= 2 * slowRate && latest.wrong >= 2)) {
    return null;
  }
  return {
    rule: 'overrun',
    first: group[0].firstBar,
    last: group[0].lastBar,
    above: Math.round(1.1 * c),
    tryBpm: Math.round(c),
    fastRate: round2(rate),
    slowRate: round2(slowRate),
    runs: group.length,
  };
}

/** Advise a slower tempo if the player clearly misses more when playing faster. */
export function speedVsMisses(
  runs: Run[],
  range?: { first: number; last: number },
): SpeedAdvice | null {
  const group = pickGroup(runs.filter(isValid), range);
  if (!group || group.length < MIN_RUNS) return null;
  const advice = halvesRule(group) ?? overrunRule(group);
  if (!advice || advice.tryBpm < 30) return null;
  return advice;
}

/** Bars the player hesitates on most (at least 3 hesitations and 25% of strikes), worst first. */
export function slowBars(
  bars: { bar: number; strikes: number; hesitations: number }[],
  max = 3,
): number[] {
  return bars
    .filter(
      (b) => b.strikes > 0 && b.hesitations >= 3 && b.hesitations / b.strikes >= 0.25,
    )
    .map((b) => ({ bar: b.bar, ratio: b.hesitations / b.strikes }))
    .sort((a, b) => b.ratio - a.ratio || a.bar - b.bar)
    .slice(0, Math.max(0, max))
    .map((b) => b.bar);
}

