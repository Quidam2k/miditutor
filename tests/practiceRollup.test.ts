import { describe, expect, it } from 'vitest';
import { rollup } from '../src/shared/practiceRollup';

const piece = (name: string) => ({ kind: 'piece', timestamp: 0, piece: name });
const follow = (result: string, bar = 1, note = 73, fingers?: unknown[]) => ({
  kind: 'follow', timestamp: 0, result, bar, note, fingers,
});
const lap = { kind: 'lap', timestamp: 0, lap: 2 };
const spoiled = { kind: 'lap-spoiled', timestamp: 0 };

describe('rollup', () => {
  it('returns an empty rollup for empty input', () => {
    expect(rollup([])).toEqual({ from: null, to: null, pieces: [] });
  });

  it('sorts dates, preserves file order, and carries the piece across days', () => {
    const result = rollup([
      {
        date: '2026-01-02',
        entries: [follow('advance'), piece('B'), follow('complete')],
      },
      {
        date: '2026-01-01',
        entries: [piece('A'), follow('partial')],
      },
    ]);
    expect(result.from).toBe('2026-01-01');
    expect(result.to).toBe('2026-01-02');
    expect(result.pieces.map(p => [p.piece, p.strikes])).toEqual([['A', 2], ['B', 1]]);
    expect(result.pieces[0].days).toEqual([
      { date: '2026-01-01', strikes: 1, misses: 0, rate: 0, laps: 0, cleanLaps: 0 },
      { date: '2026-01-02', strikes: 1, misses: 0, rate: 0, laps: 0, cleanLaps: 0 },
    ]);
  });

  it('attributes strikes and laps before any piece to unknown', () => {
    const result = rollup([{
      date: '2026-01-01',
      entries: [follow('wrong'), lap, piece('A'), follow('advance')],
    }]);
    expect(result.pieces.find(p => p.piece === '(unknown)')).toMatchObject({
      strikes: 1, misses: 1, rate: 1, laps: 1, cleanLaps: 1,
    });
  });

  it('counts all six strike results and excludes ignored entries', () => {
    const result = rollup([{
      date: '2026-01-01',
      entries: [
        piece('A'),
        ...['advance', 'partial', 'complete', 'loop', 'wrong', 'stray', 'ignored']
          .map(result => follow(result)),
      ],
    }]).pieces[0];
    expect(result).toMatchObject({ strikes: 6, misses: 2, rate: 0.333 });
    expect(result.days[0]).toMatchObject({ strikes: 6, misses: 2, rate: 0.333 });
    expect(result.worstBars).toEqual([{ bar: 1, strikes: 6, misses: 2, rate: 0.333 }]);
  });

  it('orders worst bars by misses, rate, then bar, and applies both options', () => {
    const bars = [
      [1, 4, 2], [2, 3, 2], [3, 3, 2],
      [4, 2, 2], [5, 4, 3], [6, 3, 0],
    ];
    const days = [{
      date: '2026-01-01',
      entries: [
        piece('A'),
        ...bars.flatMap(([bar, strikes, misses]) =>
          Array.from({ length: strikes }, (_, i) => follow(i < misses ? 'wrong' : 'advance', bar))),
      ],
    }];
    expect(rollup(days).pieces[0].worstBars).toEqual([
      { bar: 5, strikes: 4, misses: 3, rate: 0.75 },
      { bar: 2, strikes: 3, misses: 2, rate: 0.667 },
      { bar: 3, strikes: 3, misses: 2, rate: 0.667 },
      { bar: 1, strikes: 4, misses: 2, rate: 0.5 },
    ]);
    expect(rollup(days, { minStrikes: 2, topBars: 2 }).pieces[0].worstBars
      .map(bar => bar.bar)).toEqual([5, 4]);
    expect(rollup(days, { minStrikes: 4 }).pieces[0].worstBars
      .map(bar => bar.bar)).toEqual([5, 1]);
    expect(rollup(days, { topBars: 0 }).pieces[0].worstBars).toEqual([]);
  });

  it('attributes each miss once to the nearest note, using the lower note on ties', () => {
    const result = rollup([{
      date: '2026-01-01',
      entries: [
        piece('A'),
        follow('wrong', 1, 73, [
          { note: 76, finger: '2', hand: 'L' },
          { note: 72, finger: '5', hand: 'R' },
        ]),
        follow('stray', 1, 74, [
          { note: 76, finger: '4', hand: 'R' },
          { note: 72, finger: '5', hand: 'invalid' },
        ]),
        follow('wrong', 1, 75, [
          { note: 79, finger: '1', hand: 'L' },
          { note: 74, finger: '5', hand: 'R' },
        ]),
        follow('advance', 1, 72, [{ note: 72, finger: '1', hand: 'L' }]),
      ],
    }]).pieces[0];
    expect(result.fingerData).toBe(true);
    expect(result.fingers).toEqual([
      { hand: 'R', finger: '5', misses: 2 },
      { hand: '?', finger: '5', misses: 1 },
    ]);
  });

  it('sorts equally frequent fingers by hand and finger and defaults missing hands', () => {
    const result = rollup([{
      date: '2026-01-01',
      entries: [
        piece('A'),
        ...[
          { note: 73, finger: '5', hand: 'R' },
          { note: 73, finger: '3', hand: 'L' },
          { note: 73, finger: '1', hand: 'L' },
          { note: 73, finger: '2' },
        ].map(finger => follow('wrong', 1, 73, [finger])),
      ],
    }]).pieces[0];
    expect(result.fingers.map(f => [f.hand, f.finger])).toEqual([
      ['?', '2'], ['L', '1'], ['L', '3'], ['R', '5'],
    ]);
  });

  it('distinguishes absent finger data from an empty fingers array on a miss', () => {
    const result = rollup([{
      date: '2026-01-01',
      entries: [
        piece('A'), follow('wrong'),
        piece('B'), follow('stray', 1, 73, []),
        piece('C'), follow('advance', 1, 73, []),
      ],
    }]);
    expect(result.pieces.find(p => p.piece === 'A')).toMatchObject({
      fingerData: false, fingers: [],
    });
    expect(result.pieces.find(p => p.piece === 'B')).toMatchObject({
      fingerData: true, fingers: [],
    });
    expect(result.pieces.find(p => p.piece === 'C')?.fingerData).toBe(false);
  });

  it('tracks spoiled laps and resets on lap completion, piece opening, and day start', () => {
    const result = rollup([
      {
        date: '2026-01-01',
        entries: [piece('A'), spoiled, lap, lap, spoiled, piece('A'), lap, spoiled],
      },
      {
        date: '2026-01-02',
        entries: [lap, spoiled, lap, lap],
      },
    ]).pieces[0];
    expect(result).toMatchObject({
      strikes: 0, misses: 0, rate: 0, laps: 6, cleanLaps: 4,
    });
    expect(result.days).toEqual([
      { date: '2026-01-01', strikes: 0, misses: 0, rate: 0, laps: 3, cleanLaps: 2 },
      { date: '2026-01-02', strikes: 0, misses: 0, rate: 0, laps: 3, cleanLaps: 2 },
    ]);
  });

  it('skips malformed entries and invalid optional fields without throwing', () => {
    const result = rollup([{
      date: '2026-01-01',
      entries: [
        null, undefined, false, 42, 'text', [], { raw: 'broken' },
        {}, { kind: 'follow' }, { kind: 'follow', result: 'unexpected' },
        { kind: 'piece' }, { kind: 'piece', piece: 42 },
        piece('A'), { kind: 'piece', piece: '' },
        follow('wrong', -1, 73, [
          null, {}, { note: '73', finger: '5' },
          { note: 73, finger: 5 }, { note: NaN, finger: '5' },
          { note: 73, finger: '' },
        ]),
        follow('stray', 1.5),
        follow('advance', NaN),
        { kind: 'follow', result: 'wrong', note: Infinity, fingers: [{ note: 72, finger: '5' }] },
      ],
    }]);
    expect(result.pieces).toHaveLength(1);
    expect(result.pieces[0]).toMatchObject({
      piece: 'A', strikes: 4, misses: 3, rate: 0.75,
      worstBars: [], fingers: [], fingerData: true,
    });
  });

  it('drops inactive pieces and days while retaining the full input date range', () => {
    const result = rollup([
      { date: '2026-01-01', entries: [piece('Unused'), follow('ignored')] },
      { date: '2026-01-02', entries: [piece('A'), follow('advance')] },
      { date: '2026-01-03', entries: [spoiled, piece('Also unused')] },
    ]);
    expect(result.from).toBe('2026-01-01');
    expect(result.to).toBe('2026-01-03');
    expect(result.pieces.map(p => p.piece)).toEqual(['A']);
    expect(result.pieces[0].days.map(d => d.date)).toEqual(['2026-01-02']);
  });

  it('does not mutate the input', () => {
    const days = [
      { date: '2026-01-02', entries: [follow('wrong', 1, 73, [{ note: 72, finger: '5' }])] },
      { date: '2026-01-01', entries: [piece('A'), follow('advance')] },
    ];
    const before = JSON.stringify(days);
    rollup(days);
    expect(JSON.stringify(days)).toBe(before);
  });
});
