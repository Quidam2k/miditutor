import { describe, expect, it } from 'vitest';
import { BarSpan, NoteBox, barsUnder, describeNotes, markNotes, notesInCircle, notesInShare } from '../src/shared/reviewCircle';

const bars: BarSpan[] = [
  { measure: 10, x0: 0, x1: 100 },
  { measure: 11, x0: 100, x1: 200 },
  { measure: 12, x0: 200, x1: 300 },
];

const note = (measure: number, staff: number, x: number, y: number, name: string, beat: number): NoteBox =>
  ({ measure, staff, x, y, name, beat });

describe('barsUnder', () => {
  it('a circle inside one bar marks that bar', () => {
    expect(barsUnder(bars, 150, 20)).toEqual([11]);
  });

  it('a circle across a bar line marks each bar it covers', () => {
    expect(barsUnder(bars, 100, 30)).toEqual([10, 11]);
    expect(barsUnder(bars, 150, 120)).toEqual([10, 11, 12]);
  });

  it('only grazing the next bar does not mark it', () => {
    // spans 85..135: 15/50 in bar 10 (30%), 35/50 in bar 11
    expect(barsUnder(bars, 110, 25)).toEqual([10, 11]);
    // spans 95..135: 5/40 in bar 10 (12%) is a graze
    expect(barsUnder(bars, 115, 20)).toEqual([11]);
  });

  it('outside every bar marks nothing', () => {
    expect(barsUnder(bars, 400, 20)).toEqual([]);
  });
});

describe('notesInCircle / notesInShare', () => {
  const notes = [
    note(11, 1, 120, 40, 'E5', 1),
    note(11, 1, 150, 50, 'C5', 2),
    note(11, 2, 150, 140, 'G3', 2),
    note(12, 1, 210, 40, 'D5', 1),
  ];

  it('score side keeps only the bar\'s notes inside the circle', () => {
    expect(notesInCircle(notes, 11, { cx: 150, cy: 50, r: 15 }).map((n) => n.name)).toEqual(['C5']);
    // the D5 is inside the radius but belongs to bar 12
    expect(notesInCircle(notes, 11, { cx: 200, cy: 40, r: 15 })).toEqual([]);
  });

  it('scan side maps the circle\'s share of the bar onto the score bar', () => {
    const box = { x: 100, w: 100 };
    expect(notesInShare(notes, 11, null, box, 0.4, 0.6).map((n) => n.name)).toEqual(['C5', 'G3']);
    expect(notesInShare(notes, 11, 2, box, 0.4, 0.6).map((n) => n.name)).toEqual(['G3']);
    expect(notesInShare(notes, 11, null, box, -0.5, 0.25).map((n) => n.name)).toEqual(['E5']);
  });
});

describe('markNotes / describeNotes', () => {
  it('orders by beat, then low to high, and groups a chord', () => {
    const marked = markNotes([
      note(11, 1, 150, 50, 'C5', 2),
      note(11, 2, 150, 140, 'G3', 2),
      note(11, 2, 150, 150, 'E3', 2),
      note(11, 1, 120, 40, 'E5', 1.5),
    ]);
    expect(marked.map((n) => n.name)).toEqual(['E5', 'E3', 'G3', 'C5']);
    expect(describeNotes(marked)).toBe('E5 (beat 1.5), E3 G3 C5 (beat 2)');
  });

  it('nothing circled describes as nothing', () => {
    expect(describeNotes([])).toBe('');
  });
});
