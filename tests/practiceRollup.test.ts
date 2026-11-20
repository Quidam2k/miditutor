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
    expect(result.worstBars).toEqual([{ bar: 1, strikes: 6, misses: 2, rate: 0.333, hesitations: 0 }]);
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
      { bar: 5, strikes: 4, misses: 3, rate: 0.75, hesitations: 0 },
      { bar: 2, strikes: 3, misses: 2, rate: 0.667, hesitations: 0 },
      { bar: 3, strikes: 3, misses: 2, rate: 0.667, hesitations: 0 },
      { bar: 1, strikes: 4, misses: 2, rate: 0.5, hesitations: 0 },
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

  it('#6460 counts a step over twice his usual gap as a hesitation in its bar', () => {
    // Steps 0..10 in bars 1-3, 500 ms apart, except step 6 (bar 2) after 1600 ms and step 9 after 12 s (a stop).
    const gaps = [0, 500, 500, 500, 500, 500, 1600, 500, 500, 12000, 500];
    let t = 0;
    const entries: unknown[] = [piece('A')];
    gaps.forEach((gap, step) => {
      t += gap;
      entries.push({ kind: 'follow', timestamp: t, result: 'advance', step, bar: 1 + Math.floor(step / 4), note: 60 });
    });
    entries.push({ kind: 'follow', timestamp: t + 100, result: 'wrong', step: 10, bar: 3, note: 61 });
    const a = rollup([{ date: '2026-01-01', entries }], { minStrikes: 1 }).pieces[0];
    expect(a.spotBars.map(b => [b.bar, b.misses, b.hesitations])).toEqual([[3, 1, 0], [2, 0, 1]]);
    expect(a.worstBars.map(b => b.bar)).toEqual([3]);
  });

  it('#6460 needs 8 gaps before it calls anything a hesitation', () => {
    const entries: unknown[] = [piece('A'), ...[0, 500, 5000].map((t, step) => (
      { kind: 'follow', timestamp: t, result: 'advance', step, bar: 1, note: 60 }))];
    expect(rollup([{ date: '2026-01-01', entries }], { minStrikes: 1 }).pieces[0].spotBars).toEqual([]);
  });
});

describe('runs (#6530 D)', () => {
  it('collects lap, pass and Keep going laps with tempo and misses', () => {
    const r = rollup([{ date: '2026-11-19', entries: [
      { kind: 'piece', piece: 'P' },
      { kind: 'lap', lap: 1, firstBar: 3, lastBar: 6, bpm: 72, wrong: 1, timestamp: 10 },
      { kind: 'lap', lap: 2, firstBar: 3, lastBar: 6, bpm: 90, wrong: 0, skipped: true, timestamp: 11 },
      { kind: 'pass', firstBar: 1, lastBar: 20, bpm: 80, wrong: 4, timestamp: 12 },
      { kind: 'keep', on: true, bpm: 60, firstBar: 5, lastBar: 8 },
      { kind: 'keep', lap: 1, bpm: 60, missed: 2, wrong: 1, timestamp: 13 },
      { kind: 'keep', on: false },
      { kind: 'lap', lap: 3, bpm: null, firstBar: 3, lastBar: 6 },
    ] }]);
    const p = r.pieces.find((x) => x.piece === 'P')!;
    expect(p.runs).toEqual([
      { date: '2026-11-19', at: 10, kind: 'lap', bpm: 72, wrong: 1, firstBar: 3, lastBar: 6 },
      { date: '2026-11-19', at: 12, kind: 'pass', bpm: 80, wrong: 4, firstBar: 1, lastBar: 20 },
      { date: '2026-11-19', at: 13, kind: 'keep', bpm: 60, wrong: 3, firstBar: 5, lastBar: 8 },
    ]);
    expect(p.laps).toBe(3);
  });
});
