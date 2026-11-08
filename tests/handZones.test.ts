import { describe, it, expect } from 'vitest';
import { handZones, fishingShifts, FISHING_SEMITONES } from '../src/renderer/engine/HandZones';

type Note = [midi: number, hand: 'L' | 'R', finger?: string];

function st(step: number, bar: number, ...notes: Note[]) {
  return {
    step,
    bar,
    notes: notes.map(([midi, hand, finger]) => ({
      midi,
      hand,
      ...(finger === undefined ? {} : { finger }),
    })),
  };
}

function rightScale() {
  return [
    st(0, 1, [60, 'R']),
    st(1, 1, [62, 'R']),
    st(2, 1, [64, 'R']),
    st(3, 1, [65, 'R']),
    st(4, 2, [67, 'R']),
  ];
}

function largeShiftZones() {
  return handZones([
    st(0, 1, [60, 'R', '1'], [64, 'R', '3']),
    st(2, 2, [72, 'R', '1'], [76, 'R', '3']),
  ], 'R');
}

describe('handZones', () => {
  it('groups an unfingered right-hand five-note scale into one zone', () => {
    expect(handZones(rightScale(), 'R')).toEqual([
      {
        hand: 'R',
        index: 0,
        firstStep: 0,
        lastStep: 4,
        firstBar: 1,
        lastBar: 2,
        low: 60,
        high: 67,
        steps: [0, 1, 2, 3, 4],
      },
    ]);
  });

  it('keeps left-hand activity from splitting or extending right-hand zones', () => {
    const steps = [
      st(-1, 1, [36, 'L']),
      st(0, 1, [60, 'R'], [36, 'L']),
      st(1, 1, [62, 'R'], [48, 'L']),
      st(2, 1, [64, 'R'], [36, 'L']),
      st(3, 1, [65, 'R'], [48, 'L']),
      st(4, 2, [67, 'R'], [36, 'L']),
      st(5, 2, [48, 'L']),
    ];

    expect(handZones(steps, 'R')).toEqual(handZones(rightScale(), 'R'));
    expect(handZones(steps, 'L')).toEqual([
      {
        hand: 'L',
        index: 0,
        firstStep: -1,
        lastStep: 5,
        firstBar: 1,
        lastBar: 2,
        low: 36,
        high: 48,
        steps: [-1, 0, 1, 2, 3, 4, 5],
      },
    ]);
  });

  it('starts a new zone when a written finger moves to a different key', () => {
    const zones = handZones([
      st(0, 1, [60, 'R', '1']),
      st(1, 1, [62, 'R', '2']),
      st(2, 2, [67, 'R', '1']),
    ], 'R');

    expect(zones).toEqual([
      {
        hand: 'R',
        index: 0,
        firstStep: 0,
        lastStep: 1,
        firstBar: 1,
        lastBar: 1,
        low: 60,
        high: 62,
        steps: [0, 1],
      },
      {
        hand: 'R',
        index: 1,
        firstStep: 2,
        lastStep: 2,
        firstBar: 2,
        lastBar: 2,
        low: 67,
        high: 67,
        steps: [2],
      },
    ]);
  });

  it('returns no zones for empty input', () => {
    expect(handZones([], 'R')).toEqual([]);
    expect(handZones([], 'L')).toEqual([]);
  });
});

describe('fishingShifts', () => {
  it('flags a twelve-semitone shift without a rest', () => {
    expect(fishingShifts(largeShiftZones(), new Set<number>())).toEqual([
      {
        hand: 'R',
        step: 2,
        bar: 2,
        from: [60, 64],
        to: [72, 76],
        semitones: 12,
      },
    ]);
  });

  it.each([1, 2])('allows a shift when a hand rest occurs at step %i', (restStep) => {
    expect(fishingShifts(largeShiftZones(), new Set([restStep]))).toEqual([]);
  });

  it('ignores a small move by default and respects an explicit minimum', () => {
    const zones = handZones([
      st(0, 1, [60, 'R', '1'], [64, 'R', '3']),
      st(1, 1, [62, 'R', '1'], [66, 'R', '3']),
    ], 'R');

    expect(zones).toHaveLength(2);
    expect(FISHING_SEMITONES).toBe(5);
    expect(fishingShifts(zones, new Set<number>())).toEqual([]);
    expect(fishingShifts(zones, new Set<number>(), 2)).toEqual([
      {
        hand: 'R',
        step: 1,
        bar: 1,
        from: [60, 64],
        to: [62, 66],
        semitones: 2,
      },
    ]);
  });

  it('returns no shifts for empty input', () => {
    expect(fishingShifts([], new Set<number>())).toEqual([]);
  });
});
