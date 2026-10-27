import { describe, expect, it } from 'vitest';
import { Layout, LayoutSystem, ReviewEvent, foldReview, measureAtX, orderEvents, systemOfMeasure } from '../src/shared/review';

const system = (index: number, measures: [number, number] | null, over: Partial<LayoutSystem> = {}): LayoutSystem => ({
  index, page: '01.png', y0: 0, y1: 100, spacing: 20, staves: [], x_left: 100, x_right: 500,
  barlines: [100, 200, 300, 400, 500], bars: 4, measures,
  numbers: measures ? [String(measures[0]), String(measures[1])] : null, crop: `review-pages/x/s0${index}.jpg`,
  ...over,
});

const layout = (systems: LayoutSystem[], over: Partial<Layout> = {}): Layout => ({
  version: 1, slug: 'x', score: 'x.musicxml', score_sha256: 'A', crop_scale: 0.5,
  xml: { measures: 8, breaks: [1, 5], staves_per_system: 2 }, scan: { bars: 8, systems: 2 },
  match: 'exact', systems, ...over,
});

const two = layout([system(1, [1, 4]), system(2, [5, 8])]);
let n = 0;
const ev = (e: Record<string, unknown>): ReviewEvent =>
  ({ id: `e${String(++n).padStart(3, '0')}`, origin: 'solace', ts: n, ...e }) as ReviewEvent;

describe('foldReview', () => {
  it('verifies only when every line is confirmed and no mark is open', () => {
    const events = [ev({ kind: 'confirm_system', system: 1, sha: 'A' })];
    expect(foldReview(events, two, 'A').verified).toBe(false);
    events.push(ev({ kind: 'confirm_system', system: 2, sha: 'A' }));
    expect(foldReview(events, two, 'A').verified).toBe(true);
  });

  it('a later mark on a line voids its confirm; withdrawing the mark does not bring it back', () => {
    const events = [
      ev({ kind: 'confirm_system', system: 1, sha: 'A' }),
      ev({ kind: 'confirm_system', system: 2, sha: 'A' }),
      ev({ kind: 'mark', system: 2, measure: 6 }),
    ];
    const state = foldReview(events, two, 'A');
    expect(state.confirmed).toEqual({ 1: expect.any(Number) });
    expect(state.verified).toBe(false);
    const markId = state.marks[0].id;
    events.push(ev({ kind: 'withdraw', mark: markId }));
    expect(foldReview(events, two, 'A').verified).toBe(false);
    events.push(ev({ kind: 'confirm_system', system: 2, sha: 'A' }));
    expect(foldReview(events, two, 'A').verified).toBe(true);
  });

  it('an applied fix keeps other lines confirmed and needs its own line re-confirmed', () => {
    const fixed = layout(two.systems, { score_sha256: 'B' });
    const events = [
      ev({ kind: 'confirm_system', system: 1, sha: 'A' }),
      ev({ kind: 'mark', system: 2, measure: 6 }),
    ];
    const markId = foldReview(events, two, 'A').marks[0].id;
    events.push(ev({ kind: 'accept', mark: markId, before: 'A', after: 'B', proposal: 'p1' }));
    let state = foldReview(events, fixed, 'B');
    expect(state.marks[0].status).toBe('applied');
    expect(Object.keys(state.confirmed)).toEqual(['1']);
    events.push(ev({ kind: 'confirm_system', system: 2, sha: 'B' }));
    state = foldReview(events, fixed, 'B');
    expect(state.verified).toBe(true);
    expect(state.externalChange).toBe(false);
  });

  it('a change outside review (re-ingest) drops every confirm', () => {
    const events = [
      ev({ kind: 'confirm_system', system: 1, sha: 'A' }),
      ev({ kind: 'confirm_system', system: 2, sha: 'A' }),
    ];
    const state = foldReview(events, layout(two.systems, { score_sha256: 'C' }), 'C');
    expect(state.confirmed).toEqual({});
    expect(state.externalChange).toBe(true);
    expect(state.verified).toBe(false);
  });

  it('a stale layout (score changed since it was made) never verifies', () => {
    const events = [
      ev({ kind: 'confirm_system', system: 1, sha: 'B' }),
      ev({ kind: 'confirm_system', system: 2, sha: 'B' }),
    ];
    expect(foldReview(events, two, 'B').verified).toBe(false);
  });

  it('a partial layout never verifies, even with every line confirmed', () => {
    const partial = layout([system(1, [1, 4]), system(2, null)], { match: 'partial' });
    const events = [
      ev({ kind: 'confirm_system', system: 1, sha: 'A' }),
      ev({ kind: 'confirm_system', system: 2, sha: 'A' }),
    ];
    expect(foldReview(events, partial, 'A').verified).toBe(false);
  });

  it('"still wrong" keeps the mark open and collects his notes', () => {
    const events = [ev({ kind: 'mark', system: 1, measure: 2, note: 'left hand' })];
    const markId = foldReview(events, two, 'A').marks[0].id;
    events.push(ev({ kind: 'reject', mark: markId, note: 'the G is still an A' }));
    const mark = foldReview(events, two, 'A').marks[0];
    expect(mark.status).toBe('open');
    expect(mark.rejections).toEqual(['the G is still an A']);
  });
});

describe('orderEvents', () => {
  it('merges two origins by time then id and drops duplicate ids', () => {
    const a = { id: 'b', origin: 'pinocchio', ts: 5, kind: 'mark', system: 1, measure: 1 } as ReviewEvent;
    const b = { id: 'a', origin: 'solace', ts: 5, kind: 'mark', system: 1, measure: 2 } as ReviewEvent;
    const c = { id: 'c', origin: 'solace', ts: 1, kind: 'mark', system: 1, measure: 3 } as ReviewEvent;
    expect(orderEvents([a, b, c, a]).map((e) => e.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('measureAtX', () => {
  it('maps x between barlines to the score position', () => {
    const s = system(2, [5, 8]);
    expect(measureAtX(s, 150)).toBe(5);
    expect(measureAtX(s, 499)).toBe(8);
    expect(measureAtX(s, 50)).toBeNull();
    expect(measureAtX(s, 520)).toBeNull();
  });

  it('an unmapped system maps nothing', () => {
    expect(measureAtX(system(1, null), 150)).toBeNull();
  });
});

describe('systemOfMeasure', () => {
  it('finds the line holding a bar', () => {
    expect(systemOfMeasure(two, 6)?.index).toBe(2);
    expect(systemOfMeasure(two, 9)).toBeUndefined();
  });
});
