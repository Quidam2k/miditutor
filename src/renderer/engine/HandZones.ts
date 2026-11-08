// #11354 item 4 (JP homework 11/6):
// Group each hand's notes into positions and flag large shifts without a rest.
import { groupPositions, type BlockStep } from './Blocking';

export type Hand = 'L' | 'R';

export interface Zone {
  hand: Hand;
  index: number;
  firstStep: number;
  lastStep: number;
  firstBar: number;
  lastBar: number;
  low: number;
  high: number;
  steps: number[];
}

export interface Shift {
  hand: Hand;
  step: number;
  bar: number;
  from: [number, number];
  to: [number, number];
  semitones: number;
}

export const FISHING_SEMITONES = 5;

export function handZones(steps: BlockStep[], hand: Hand): Zone[] {
  const handSteps = steps
    .map(({ step, bar, notes }) => ({
      step,
      bar,
      notes: notes.filter((note) => note.hand === hand),
    }))
    .filter(({ notes }) => notes.length > 0);

  return groupPositions(handSteps)
    .filter(({ keys }) => keys.length > 0)
    .map((position, index) => ({
      hand,
      index,
      firstStep: position.firstStep,
      lastStep: position.lastStep,
      firstBar: position.firstBar,
      lastBar: position.lastBar,
      low: Math.min(...position.keys),
      high: Math.max(...position.keys),
      steps: handSteps
        .filter(({ step }) => step >= position.firstStep && step <= position.lastStep)
        .map(({ step }) => step)
        .sort((a, b) => a - b),
    }));
}

export function fishingShifts(
  zones: Zone[],
  restSteps: ReadonlySet<number>,
  min: number = FISHING_SEMITONES,
): Shift[] {
  const shifts: Shift[] = [];

  for (let i = 1; i < zones.length; i++) {
    const a = zones[i - 1]!;
    const b = zones[i]!;
    const semitones = Math.round(
      Math.abs((b.low + b.high) / 2 - (a.low + a.high) / 2),
    );

    if (semitones < min) {
      continue;
    }

    let hasRest = false;
    for (const step of restSteps) {
      if (a.lastStep < step && step <= b.firstStep) {
        hasRest = true;
        break;
      }
    }

    if (hasRest) {
      continue;
    }

    shifts.push({
      hand: b.hand,
      step: b.firstStep,
      bar: b.firstBar,
      from: [a.low, a.high],
      to: [b.low, b.high],
      semitones,
    });
  }

  return shifts;
}
