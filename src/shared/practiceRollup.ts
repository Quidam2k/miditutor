export interface DayLog { date: string; entries: unknown[] }
export interface BarStat { bar: number; strikes: number; misses: number; rate: number }
export interface FingerStat { hand: 'L' | 'R' | '?'; finger: string; misses: number }
export interface DayStat { date: string; strikes: number; misses: number; rate: number; laps: number; cleanLaps: number }
export interface PieceRollup {
  piece: string; strikes: number; misses: number; rate: number; laps: number; cleanLaps: number;
  worstBars: BarStat[]; fingers: FingerStat[]; days: DayStat[]; fingerData: boolean;
}
export interface Rollup { from: string | null; to: string | null; pieces: PieceRollup[] }

type Accumulator = PieceRollup & {
  barMap: Map<number, BarStat>;
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

  for (const day of ordered) {
    let spoiled = false;
    for (const value of Array.isArray(day.entries) ? day.entries : []) {
      const entry = record(value);
      if (!entry) continue;
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
      const lap = entry.kind === 'lap';
      if (!lap && (entry.kind !== 'follow' ||
        typeof entry.result !== 'string' || !results.has(entry.result))) continue;

      let piece = pieces.get(current);
      if (!piece) {
        piece = {
          piece: current, strikes: 0, misses: 0, rate: 0, laps: 0, cleanLaps: 0,
          worstBars: [], fingers: [], days: [], fingerData: false,
          barMap: new Map(), fingerMap: new Map(), dayMap: new Map(),
        };
        pieces.set(current, piece);
      }
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
          { bar: entry.bar, strikes: 0, misses: 0, rate: 0 };
        bar.strikes++;
        bar.misses += miss;
        piece.barMap.set(entry.bar, bar);
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
      const { barMap, fingerMap, dayMap, ...piece } = value;
      return {
        ...piece,
        rate: rate(piece.misses, piece.strikes),
        worstBars: Array.from(barMap.values(), bar => ({
          ...bar, rate: rate(bar.misses, bar.strikes),
        })).filter(bar => bar.misses > 0 && bar.strikes >= minStrikes)
          .sort((a, b) => b.misses - a.misses || b.rate - a.rate || a.bar - b.bar)
          .slice(0, topBars),
        fingers: Array.from(fingerMap.values()).sort((a, b) =>
          b.misses - a.misses || compare(a.hand, b.hand) || compare(a.finger, b.finger)),
        days: Array.from(dayMap.values(), day => ({
          ...day, rate: rate(day.misses, day.strikes),
        })),
      };
    }).sort((a, b) => b.strikes - a.strikes),
  };
}
