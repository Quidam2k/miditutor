import { describe, it, expect } from 'vitest';
import {
  binderSides,
  binderSpreads,
  paperPageStarts,
  confirmedLines,
  binderWarning, // #6083
} from '../src/shared/binderPrint';

const layout = {
  score_sha256: 'score-sha',
  systems: [
    { index: 1, page: '01.png', measures: [1, 4], extra: true },
    { index: 2, page: '01.png', measures: [5, 10] },
    { index: 3, page: '01.png', measures: [11, 16] },
    { index: 4, page: '01.png', measures: [17, 22] },
    { index: 5, page: '02.png', measures: [23, 27] },
    { index: 6, page: '02.png', measures: [28, 33] },
    { index: 7, page: '02.png', measures: [34, 39] },
    { index: 8, page: '02.png', measures: [40, 44] },
    { index: 9, page: '02.png', measures: [45, 50] },
    { index: 10, page: '03.png', measures: [51, 55] },
    { index: 11, page: '03.png', measures: [56, 60] },
    { index: 12, page: '03.png', measures: [61, 65] },
    { index: 13, page: '03.png', measures: [66, 69] },
  ],
};

function jsonl(...events: unknown[]): string {
  return events.map((event) => JSON.stringify(event)).join('\n');
}

describe('binder page order', () => {
  it('4-page piece: 8 sides 1,1,2,2,3,3,4,4; spreads 1-2, 2-3, 3-4', () => {
    expect(binderSides(4)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
    expect(binderSpreads(4)).toEqual([[1, 2], [2, 3], [3, 4]]);
  });

  it('prints both sides of a single page with no spread', () => {
    expect(binderSides(1)).toEqual([1, 1]);
    expect(binderSpreads(1)).toEqual([]);
  });

  it('prints an odd page count without padding', () => {
    expect(binderSides(3)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(binderSpreads(3)).toEqual([[1, 2], [2, 3]]);
  });

  it('rejects zero, negative, fractional and non-finite page counts', () => {
    for (const pages of [0, -1, 2.5, NaN, Infinity, -Infinity]) {
      expect(binderSides(pages)).toEqual([]);
      expect(binderSpreads(pages)).toEqual([]);
    }
  });
});

describe('paperPageStarts', () => {
  it('reads the three paper pages from the 13-system layout', () => {
    expect(layout.systems).toHaveLength(13);
    expect(paperPageStarts(layout)).toEqual([1, 23, 51]);
  });

  it('uses system order rather than sorting page names or indices', () => {
    expect(paperPageStarts({
      systems: [
        { index: 2, page: 'z.png', measures: [5, 8] },
        { index: 1, page: 'a.png', measures: [9, 12] },
      ],
    })).toEqual([5, 9]);
  });

  it('rejects malformed layouts and measures', () => {
    const badMeasures: unknown[] = [null, 5, [], [1], [1, 2, 3], ['1', 4], [0, 4], [5, 4], [1, 2.5]];
    for (const malformed of [null, {}, { systems: 5 }, { systems: [null] }]) {
      expect(paperPageStarts(malformed)).toEqual([]);
    }
    for (const measures of badMeasures) {
      expect(paperPageStarts({
        systems: [
          layout.systems[0],
          { index: 2, page: '02.png', measures },
        ],
      })).toEqual([]);
    }
    for (const system of [
      { index: 0, page: '01.png', measures: [1, 4] },
      { index: 1, page: '', measures: [1, 4] },
      { index: 1, page: 1, measures: [1, 4] },
    ]) {
      expect(paperPageStarts({ systems: [system] })).toEqual([]);
    }
  });
});

describe('confirmedLines', () => {
  it('counts matching sha values and legacy confirmations without sha', () => {
    expect(confirmedLines(layout, jsonl(
      { kind: 'confirm_system', system: 1, sha: 'score-sha' },
      { kind: 'confirm_system', system: 2, sha: 'old-sha' },
      { kind: 'confirm_system', system: 3 },
    ))).toEqual({ confirmed: 2, total: 13 });
  });

  it('accepts an event sha when the layout has no string sha', () => {
    expect(confirmedLines({ systems: layout.systems }, jsonl(
      { kind: 'confirm_system', system: 1, sha: 'any-sha' },
    ))).toEqual({ confirmed: 1, total: 13 });
  });

  it('counts duplicate confirmations once and ignores unknown system indices', () => {
    expect(confirmedLines(layout, jsonl(
      { id: 'a', kind: 'confirm_system', system: 1 },
      { id: 'b', kind: 'confirm_system', system: 1 },
      { kind: 'confirm_system', system: 0 },
      { kind: 'confirm_system', system: 14 },
      { kind: 'confirm_system', system: '2' },
    ))).toEqual({ confirmed: 1, total: 13 });
  });

  it('skips blank, invalid and unrelated JSONL lines', () => {
    const events = '\nnot json\r\nnull\n[]\n42\n{}\n{"kind":\n' +
      jsonl({ kind: 'confirm_system', system: 1 }) + '\n\n';
    expect(confirmedLines(layout, events)).toEqual({ confirmed: 1, total: 13 });
  });

  it('uses zero totals for malformed layouts', () => {
    const events = jsonl({ kind: 'confirm_system', system: 1 });
    for (const malformed of [null, {}, { systems: 5 }, {
      systems: [{ index: 1, page: '01.png', measures: [4, 1] }],
    }]) {
      expect(confirmedLines(malformed, events)).toEqual({ confirmed: 0, total: 0 });
    }
  });
});

describe('binderWarning (#6083)', () => {
  it('has no banner for a verified score', () => {
    expect(binderWarning(true, 0, 0)).toBe('');
  });
  it('warns in plain words, and says it still prints', () => {
    expect(binderWarning(false, 0, 0)).toBe('Not verified yet. You can still print it, but check it against your paper first.');
  });
  it('adds the confirmed lines when there are some', () => {
    expect(binderWarning(false, 3, 9)).toContain('(3 of 9 lines confirmed)');
  });
});

describe('binder sheet fill (#6090)', () => {
  it('leaves a gap alone when the drawing is already as tall as the sheet area', async () => {
    const { gapForFill, AREA_ASPECT } = await import('../src/shared/binderPrint');
    expect(gapForFill(740, 740 / AREA_ASPECT + 5, 4, 7)).toBe(7);
    expect(gapForFill(740, 500, 1, 7)).toBe(7);
  });
  it('widens the gap so width/height reaches the sheet area shape, capped', async () => {
    const { gapForFill, AREA_ASPECT, MAX_SYSTEM_GAP } = await import('../src/shared/binderPrint');
    const g = gapForFill(740, 400, 4, 7);
    expect(g).toBeGreaterThan(7);
    // 3 gaps of 10px per staff-space absorb exactly the missing height
    expect(400 + (g - 7) * 10 * 3).toBeCloseTo(740 / AREA_ASPECT, 5);
    expect(gapForFill(740, 10, 2, 7)).toBe(MAX_SYSTEM_GAP);
  });
  it('keeps the hole side at least 0.55 in and inside the sheet', async () => {
    const { HOLE_IN, EDGE_IN, FOLIO_IN } = await import('../src/shared/binderPrint');
    expect(HOLE_IN).toBeGreaterThanOrEqual(0.55);
    expect(HOLE_IN + EDGE_IN).toBeLessThan(2);
    expect(FOLIO_IN).toBeGreaterThan(0);
  });
});
