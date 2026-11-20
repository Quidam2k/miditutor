// #6530 C (asg 13312): tempo climbing on Keep going: a target tempo, up after clean time, down after a rough lap.
import { clampBpm, MIN_BPM } from './KeepGoing';
import type { KeepLap } from './KeepGoing';

export type Reaction = 'gentle' | 'normal' | 'quick';

export interface ReactionRule {
  cleanLaps: number;
  minSec: number;
  cleanMax: number;
  downOver: number;
  step: number;
}

export const REACTIONS: Record<Reaction, ReactionRule> = {
  gentle: { cleanLaps: 3, minSec: 60, cleanMax: 1, downOver: 3, step: 2 },
  normal: { cleanLaps: 2, minSec: 45, cleanMax: 1, downOver: 2, step: 4 },
  quick: { cleanLaps: 1, minSec: 30, cleanMax: 0, downOver: 1, step: 6 },
};

export interface Climb {
  target: number;
  start: number;
  bpm: number;
  peak: number;
  streak: number;
  secAtBpm: number;
  reached: boolean;
}

export type ClimbChange = 'up' | 'down' | 'hold' | 'reached';

export function startClimb(target: number, recentClean: number | null): Climb {
  const t = clampBpm(target);
  let start: number;
  if (typeof recentClean === 'number' && Number.isFinite(recentClean) && recentClean > 0) {
    start = Math.min(clampBpm(recentClean), t);
  } else {
    start = clampBpm(Math.round(0.7 * t));
  }
  start = Math.max(start, MIN_BPM);
  return { target: t, start, bpm: start, peak: start, streak: 0, secAtBpm: 0, reached: false };
}

export function climbLap(
  c: Climb,
  lap: Pick<KeepLap, 'bpm' | 'missed' | 'wrong' | 'notes'>,
  lapSec: number,
  reaction: Reaction,
): { climb: Climb; change: ClimbChange } {
  if (lap.notes === 0) return { climb: { ...c }, change: 'hold' };

  const rule = REACTIONS[reaction];
  const m = lap.missed + lap.wrong;
  const secAtBpm = c.secAtBpm + Math.max(0, lapSec);

  if (m > rule.downOver) {
    // One step down, but never more than two steps below the start.
    const floor = Math.max(c.start - 2 * rule.step, MIN_BPM);
    const bpm = Math.min(c.bpm, Math.max(floor, c.bpm - rule.step));
    const moved = bpm !== c.bpm;
    return {
      climb: { ...c, bpm, streak: 0, secAtBpm: 0 },
      change: moved ? 'down' : 'hold',
    };
  }

  if (m <= rule.cleanMax) {
    if (c.bpm >= c.target && !c.reached) {
      return {
        climb: { ...c, secAtBpm, streak: c.streak + 1, reached: true },
        change: 'reached',
      };
    }
    const streak = c.streak + 1;
    if (streak >= rule.cleanLaps && secAtBpm >= rule.minSec && c.bpm < c.target) {
      const bpm = Math.min(c.target, c.bpm + rule.step);
      return {
        climb: { ...c, bpm, peak: Math.max(c.peak, bpm), streak: 0, secAtBpm: 0 },
        change: 'up',
      };
    }
    return { climb: { ...c, streak, secAtBpm }, change: 'hold' };
  }

  // Hold lap: time counts, the clean streak does not survive.
  return { climb: { ...c, streak: 0, secAtBpm }, change: 'hold' };
}

export function climbPercent(c: Climb): number {
  if (c.target <= c.start) return 100;
  const p = Math.round((100 * (c.bpm - c.start)) / (c.target - c.start));
  return Math.max(0, Math.min(100, p));
}

export function climbLabel(c: Climb, change: ClimbChange): string {
  switch (change) {
    case 'up':
      return `Clean! Up to ♩ = ${c.bpm}.`;
    case 'down':
      return `A rough lap: back to ♩ = ${c.bpm}.`;
    case 'reached':
      return `♩ = ${c.target} reached!`;
    default:
      return `♩ = ${c.bpm}, aiming for ${c.target}.`;
  }
}

const TEMPO_PATTERNS: RegExp[] = [
  /(?:♩|\bq)\s*=\s*(\d{2,3})(?!\d)/gi,
  /\b(\d{2,3})\s*bpm\b/gi,
  /\b(?:tempo|metronome)\s*(?:of|at|:|=)?\s*(\d{2,3})(?!\d)/gi,
  /\bM\.?M\.?\s*[=:]?\s*(\d{2,3})(?!\d)/gi,
];

export function parseTempo(text: string): number | null {
  let best: { index: number; value: number } | null = null;
  for (const re of TEMPO_PATTERNS) {
    for (const match of text.matchAll(re)) {
      const value = Number(match[1]);
      if (value < 20 || value > 240) continue;
      const index = match.index ?? 0;
      if (!best || index < best.index) best = { index, value };
    }
  }
  return best ? best.value : null;
}
