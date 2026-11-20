export interface DayLog { date: string; entries: unknown[] }
export interface BarStat { bar: number; strikes: number; misses: number; rate: number; hesitations: number }
export interface FingerStat { hand: 'L' | 'R' | '?'; finger: string; misses: number }
export interface DayStat { date: string; strikes: number; misses: number; rate: number; laps: number; cleanLaps: number }
export interface PieceRollup {
  piece: string; strikes: number; misses: number; rate: number; laps: number; cleanLaps: number;
  worstBars: BarStat[]; fingers: FingerStat[]; days: DayStat[]; fingerData: boolean;
  /** #6460: bars he misses or hesitates on, most first (trouble spots come from these). */
  spotBars: BarStat[];
  /** #6530 D: each loop lap, whole pass and Keep going lap with its tempo and wrong notes (speed vs misses). */
  runs: RunStat[];
}
export interface RunStat { date: string; at: number; kind: 'lap' | 'pass' | 'keep'; bpm: number; wrong: number; firstBar: number; lastBar: number; wrongBars: number[] }
export interface Rollup { from: string | null; to: string | null; pieces: PieceRollup[] }

type Accumulator = PieceRollup & {
  barMap: Map<number, BarStat>;
  gaps: { bar: number; gap: number }[];
  fingerMap: Map<string, FingerStat>;
  dayMap: Map<string, DayStat>;
};
type Candidate = { note: number; hand: FingerStat['hand']; finger: string };

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
/** #6460: a step that took over twice his usual gap (median, per piece) is a hesitation. */
const HESITATE_FACTOR = 2;
const MIN_GAPS = 8;
const MAX_GAP_MS = 10_000; // longer than this he stopped, not hesitated
const MAX_SPOT_BARS = 30;
const MOVED_ON = new Set(['advance', 'complete', 'loop']);
const MAX_RUNS = 400;
const bar = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function rate(misses: number, strikes: number): number {
  return strikes ? Math.round(misses / strikes * 1000) / 1000 : 0;
}

export function rollup(days: DayLog[], opts?: { topBars?: number; minStrikes?: number }): Rollup {
  const ordered = days.slice().sort((a, b) => compare(a.date, b.date));
  const pieces = new Map<string, Accumulator>();
  const results = new Set(['advance', 'partial', 'complete', 'loop', 'wrong', 'stray']);
  const minStrikes = opts?.minStrikes ?? 3;
  const topBars = Math.max(0, Math.floor(opts?.topBars ?? 5));
  let current = '(unknown)';

  const getPiece = (name: string): Accumulator => {
    let piece = pieces.get(name);
    if (!piece) {
      piece = {
        piece: name, strikes: 0, misses: 0, rate: 0, laps: 0, cleanLaps: 0,
        worstBars: [], fingers: [], days: [], fingerData: false, spotBars: [], runs: [],
        barMap: new Map(), fingerMap: new Map(), dayMap: new Map(), gaps: [],
      };
      pieces.set(name, piece);
    }
    return piece;
  };

  for (const day of ordered) {
    let keepRange: { first: number; last: number } | null = null;
    let spoiled = false;
    let prev: { piece: string; step: number; at: number } | null = null;
    for (const value of Array.isArray(day.entries) ? day.entries : []) {
      const entry = record(value);
      if (!entry) continue;
      if (entry.kind === 'piece' || entry.kind === 'lap' || entry.kind === 'loop') prev = null;
      if (entry.kind === 'piece') {
        if (typeof entry.piece === 'string' && entry.piece.trim()) {
          current = entry.piece;
          spoiled = false;
        }
        continue;
      }
      if (entry.kind === 'lap-spoiled') {
        spoiled = true;
        continue;
      }
      // #6530 D: a run's tempo and misses. A Keep going lap gets its bars from the 'keep' on event.
      if (entry.kind === 'keep' && entry.on === true) {
        keepRange = bar(entry.firstBar) && bar(entry.lastBar) ? { first: entry.firstBar, last: entry.lastBar } : null;
      }
      const isKeepLap = entry.kind === 'keep' && entry.on === undefined && typeof entry.lap === 'number';
      if ((entry.kind === 'lap' || entry.kind === 'pass' || isKeepLap) && entry.skipped !== true &&
        typeof entry.bpm === 'number' && Number.isFinite(entry.bpm) && entry.bpm > 0) {
        const first = isKeepLap ? keepRange?.first : entry.firstBar;
        const last = isKeepLap ? keepRange?.last : entry.lastBar;
        const wrong = (typeof entry.wrong === 'number' ? entry.wrong : 0) +
          (isKeepLap && typeof entry.missed === 'number' ? entry.missed : 0);
        if (bar(first) && bar(last) && last >= first) {
          getPiece(current).runs.push({
            date: day.date, at: typeof entry.timestamp === 'number' ? entry.timestamp : 0,
            kind: isKeepLap ? 'keep' : entry.kind as 'lap' | 'pass', bpm: entry.bpm, wrong, firstBar: first, lastBar: last,
            // #6530 E: which bars the misses hit (a Keep going lap doesn't log them).
            wrongBars: !isKeepLap && Array.isArray(entry.wrongBars) ? entry.wrongBars.filter(bar) : [],
          });
        }
      }
      if (entry.kind === 'pass' || entry.kind === 'keep') continue;
      const lap = entry.kind === 'lap';
      if (!lap && (entry.kind !== 'follow' ||
        typeof entry.result !== 'string' || !results.has(entry.result))) continue;

      const piece = getPiece(current);
      let stat = piece.dayMap.get(day.date);
      if (!stat) {
        stat = { date: day.date, strikes: 0, misses: 0, rate: 0, laps: 0, cleanLaps: 0 };
        piece.dayMap.set(day.date, stat);
      }
      if (lap) {
        piece.laps++;
        stat.laps++;
        if (!spoiled) {
          piece.cleanLaps++;
          stat.cleanLaps++;
        }
        spoiled = false;
        continue;
      }

      const miss = entry.result === 'wrong' || entry.result === 'stray' ? 1 : 0;
      piece.strikes++;
      piece.misses += miss;
      stat.strikes++;
      stat.misses += miss;
      if (typeof entry.bar === 'number' && Number.isInteger(entry.bar) && entry.bar > 0) {
        const bar = piece.barMap.get(entry.bar) ??
          { bar: entry.bar, strikes: 0, misses: 0, rate: 0, hesitations: 0 };
        bar.strikes++;
        bar.misses += miss;
        piece.barMap.set(entry.bar, bar);
        // #6460: the gap from the last correct step of this piece, today, in this lap.
        if (MOVED_ON.has(entry.result as string) && typeof entry.timestamp === 'number' &&
          Number.isFinite(entry.timestamp) && typeof entry.step === 'number' && Number.isInteger(entry.step)) {
          const gap = prev && prev.piece === current && prev.step !== entry.step ? entry.timestamp - prev.at : 0;
          if (gap > 0 && gap <= MAX_GAP_MS) piece.gaps.push({ bar: entry.bar, gap });
          prev = { piece: current, step: entry.step, at: entry.timestamp };
        }
      }
      if (!miss || !Array.isArray(entry.fingers)) continue;
      piece.fingerData = true;
      const note = entry.note;
      if (typeof note !== 'number' || !Number.isFinite(note)) continue;
      let nearest: Candidate | undefined;
      let distance = Infinity;
      for (const value of entry.fingers) {
        const finger = record(value);
        if (!finger || typeof finger.note !== 'number' || !Number.isFinite(finger.note) ||
          typeof finger.finger !== 'string' || !finger.finger.trim()) continue;
        const delta = Math.abs(finger.note - note);
        if (delta < distance || (delta === distance && (!nearest || finger.note < nearest.note))) {
          nearest = {
            note: finger.note, finger: finger.finger,
            hand: finger.hand === 'L' || finger.hand === 'R' ? finger.hand : '?',
          };
          distance = delta;
        }
      }
      if (nearest) {
        const key = `${nearest.hand}:${nearest.finger}`;
        const finger = piece.fingerMap.get(key) ??
          { hand: nearest.hand, finger: nearest.finger, misses: 0 };
        finger.misses++;
        piece.fingerMap.set(key, finger);
      }
    }
  }

  return {
    from: ordered[0]?.date ?? null,
    to: ordered[ordered.length - 1]?.date ?? null,
    pieces: Array.from(pieces.values(), value => {
      const { barMap, fingerMap, dayMap, gaps, ...piece } = value;
      if (gaps.length >= MIN_GAPS) {
        const usual = median(gaps.map(g => g.gap));
        for (const g of gaps) {
          const bar = barMap.get(g.bar);
          if (bar && g.gap > HESITATE_FACTOR * usual) bar.hesitations++;
        }
      }
      return {
        ...piece,
        runs: piece.runs.slice(-MAX_RUNS),
        rate: rate(piece.misses, piece.strikes),
        worstBars: Array.from(barMap.values(), bar => ({
          ...bar, rate: rate(bar.misses, bar.strikes),
        })).filter(bar => bar.misses > 0 && bar.strikes >= minStrikes)
          .sort((a, b) => b.misses - a.misses || b.rate - a.rate || a.bar - b.bar)
          .slice(0, topBars),
        spotBars: Array.from(barMap.values(), bar => ({
          ...bar, rate: rate(bar.misses, bar.strikes),
        })).filter(bar => bar.misses + bar.hesitations > 0 && bar.strikes >= minStrikes)
          .sort((a, b) => b.misses + b.hesitations - (a.misses + a.hesitations) || b.misses - a.misses || a.bar - b.bar)
          .slice(0, MAX_SPOT_BARS),
        fingers: Array.from(fingerMap.values()).sort((a, b) =>
          b.misses - a.misses || compare(a.hand, b.hand) || compare(a.finger, b.finger)),
        days: Array.from(dayMap.values(), day => ({
          ...day, rate: rate(day.misses, day.strikes),
        })),
      };
    }).sort((a, b) => b.strikes - a.strikes),
  };
}
