import { describe, it, expect } from 'vitest';
import { SightCandidate, notesPerBar, staffCountOf, pickSightPiece, pickHand, pickBars } from '../src/renderer/engine/SightRead';

const note = '<note><pitch><step>C</step><octave>4</octave></pitch></note>';
const rest = '<note><rest/></note>';
const grace = '<note><grace/><pitch><step>D</step><octave>4</octave></pitch></note>';
const xmlOf = (bars: string[]) => `<score-partwise><part>${bars.map((b, i) => `<measure number="${i + 1}">${b}</measure>`).join('')}</part></score-partwise>`;
/** n sounding notes in each of `bars` bars. */
const dense = (n: number, bars = 4) => xmlOf(Array.from({ length: bars }, () => note.repeat(n)));
const cand = (id: string, over: Partial<SightCandidate> = {}): SightCandidate => ({
  id, label: id, xml: dense(2), simple: false, favorite: false, drilled: 0, trusted: true, ...over,
});
const calls = (r: number) => {
  const c = { n: 0 };
  return { c, rand: () => (c.n++, r) };
};

describe('notesPerBar', () => {
  it('counts sounding notes per bar, skipping rests and grace notes', () => {
    expect(notesPerBar(xmlOf([note + note + rest + grace, note + rest]))).toBe(1.5);
  });

  it('matches notes with attributes and ignores <notations> and similar prefixes', () => {
    const xml = xmlOf(['<note default-x="3"><pitch/></note><notations/>']);
    expect(notesPerBar(xml)).toBe(1);
  });

  it('is 0 when there are no bars (or no notes)', () => {
    expect(notesPerBar('<score-partwise/>')).toBe(0);
    expect(notesPerBar(note)).toBe(0);
    expect(notesPerBar(xmlOf([rest]))).toBe(0);
  });

  it('counts a multi-part file as one relative figure', () => {
    const two = `<score-partwise><part><measure number="1">${note}</measure></part><part><measure number="1">${note}${note}</measure></part></score-partwise>`;
    expect(notesPerBar(two)).toBe(1.5);
  });
});

describe('staffCountOf', () => {
  it('reads the first <staves>, tolerating whitespace', () => {
    expect(staffCountOf('<attributes><staves>2</staves></attributes>')).toBe(2);
    expect(staffCountOf('<staves>\n  2 \n</staves><staves>3</staves>')).toBe(2);
  });

  it('is 1 when absent', () => {
    expect(staffCountOf(dense(1))).toBe(1);
  });
});

describe('pickSightPiece', () => {
  it('returns null for no candidates or only empty xml, and drops empty xml', () => {
    expect(pickSightPiece([])).toBeNull();
    expect(pickSightPiece([cand('a', { xml: '' })])).toBeNull();
    const got = pickSightPiece([cand('empty', { xml: '', simple: true }), cand('real')], () => 0);
    expect(got?.id).toBe('real');
  });

  it('tier 1: a simple, non-favorite piece wins over everything else', () => {
    const pool = [cand('easy', { xml: dense(1) }), cand('s', { simple: true, xml: dense(9) }), cand('fav', { simple: true, favorite: true })];
    for (const r of [0, 0.5, 0.999999]) expect(pickSightPiece(pool, () => r)?.id).toBe('s');
  });

  it('skips favorites in tiers 1-3', () => {
    const pool = [cand('fav', { simple: true, favorite: true }), cand('plain')];
    expect(pickSightPiece(pool, () => 0)?.id).toBe('plain');
  });

  it('tier 2: the easiest third by notes per bar, trusted only, ties by id', () => {
    const pool = [
      cand('d', { xml: dense(5) }), cand('c', { xml: dense(4) }), cand('b', { xml: dense(1) }),
      cand('a', { xml: dense(1) }), cand('e', { xml: dense(6) }), cand('f', { xml: dense(7) }),
    ];
    const seen = new Set([0, 0.4, 0.999999].map((r) => pickSightPiece(pool, () => r)?.id));
    expect([...seen].sort()).toEqual(['a', 'b']);
    // 'a' and 'b' tie; id order makes the lower id index 0
    expect(pickSightPiece(pool, () => 0)?.id).toBe('a');
    expect(pickSightPiece(pool, () => 0.999999)?.id).toBe('b');
  });

  it('tier 2 takes at least one piece, and skips untrusted ones', () => {
    const pool = [cand('x', { xml: dense(1), trusted: false }), cand('y', { xml: dense(8) }), cand('z', { xml: dense(9) })];
    expect(pickSightPiece(pool, () => 0)?.id).toBe('y');
    expect(pickSightPiece(pool, () => 0.999999)?.id).toBe('y');
  });

  it('tier 3: non-favorites when none is trusted', () => {
    const pool = [cand('u', { trusted: false }), cand('fav', { favorite: true })];
    expect(pickSightPiece(pool, () => 0)?.id).toBe('u');
  });

  it('tier 4: everything, when all are favorites', () => {
    const pool = [cand('f1', { favorite: true }), cand('f2', { favorite: true, simple: true })];
    expect(pickSightPiece(pool, () => 0)?.id).toBe('f1');
    expect(pickSightPiece(pool, () => 0.999999)?.id).toBe('f2');
  });

  it('prefers the lowest drilled within the tier', () => {
    const pool = [cand('a', { simple: true, drilled: 3 }), cand('b', { simple: true, drilled: 1 }), cand('c', { simple: true, drilled: 1 }), cand('d', { simple: true, drilled: 2 })];
    const ids = new Set([0, 0.3, 0.6, 0.999999].map((r) => pickSightPiece(pool, () => r)?.id));
    expect([...ids].sort()).toEqual(['b', 'c']);
  });

  it('lowest drilled applies in tier 2 too, after the easiest-third cut', () => {
    const pool = [cand('a', { xml: dense(1), drilled: 5 }), cand('b', { xml: dense(2), drilled: 0 }), cand('c', { xml: dense(3), drilled: 0 })];
    expect(pickSightPiece(pool, () => 0.5)?.id).toBe('a');
  });

  it('calls rand exactly once, with rand at both extremes', () => {
    const pool = [cand('a', { simple: true }), cand('b', { simple: true }), cand('c')];
    for (const r of [0, 0.999999, 1]) {
      const { c, rand } = calls(r);
      expect(pool).toContain(pickSightPiece(pool, rand));
      expect(c.n).toBe(1);
    }
  });

  it('uses Math.random by default', () => {
    expect(pickSightPiece([cand('only')])?.id).toBe('only');
  });
});

describe('pickHand', () => {
  const two = '<attributes><staves>2</staves></attributes>';

  it("is 'both' for a one-staff piece without touching rand", () => {
    const { c, rand } = calls(0);
    expect(pickHand(dense(1), rand)).toBe('both');
    expect(c.n).toBe(0);
  });

  it('picks right below 0.5 and left otherwise, with one rand() call', () => {
    const lo = calls(0.49);
    expect(pickHand(two, lo.rand)).toBe('right');
    expect(lo.c.n).toBe(1);
    expect(pickHand(two, () => 0.5)).toBe('left');
    expect(pickHand(two, () => 0.999999)).toBe('left');
  });
});

describe('pickBars', () => {
  const run = (n: number, from = 1) => Array.from({ length: n }, (_, i) => from + i);

  it('is null for no steps', () => {
    expect(pickBars([])).toBeNull();
  });

  it('dedupes and sorts, repeats and any order', () => {
    expect(pickBars([5, 3, 3, 1, 2, 4, 4], () => 0)).toEqual({ first: 1, last: 5 });
  });

  it('length is 5..8 from the first rand() call', () => {
    const steps = run(30);
    const seq = (a: number, b: number) => { const q = [a, b]; return () => q.shift() ?? 0; };
    // second rand() = 0 takes the first qualifying start (bar 1)
    expect(pickBars(steps, seq(0, 0))).toEqual({ first: 1, last: 5 });
    expect(pickBars(steps, seq(0.25, 0))).toEqual({ first: 1, last: 6 });
    expect(pickBars(steps, seq(0.5, 0))).toEqual({ first: 1, last: 7 });
    expect(pickBars(steps, seq(0.999999, 0))).toEqual({ first: 1, last: 8 });
    // second rand() near 1 takes the last qualifying start (26..30 holds the last 5 bars)
    expect(pickBars(steps, seq(0.999999, 0.999999))).toEqual({ first: 26, last: 30 });
  });

  it('uses exactly two rand() calls on a normal piece', () => {
    const { c, rand } = calls(0.3);
    pickBars(run(20), rand);
    expect(c.n).toBe(2);
  });

  it('every result spans 5..8 bars for a dense piece', () => {
    let seed = 3;
    const rand = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let i = 0; i < 200; i++) {
      const r = pickBars(run(40), rand)!;
      const len = r.last - r.first + 1;
      expect(len).toBeGreaterThanOrEqual(5);
      expect(len).toBeLessThanOrEqual(8);
      expect(r.first).toBeGreaterThanOrEqual(1);
      expect(r.last).toBeLessThanOrEqual(40);
    }
  });

  it('never ends on silent bars: last is a bar that has notes', () => {
    const steps = [1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 20];
    let seed = 11;
    const rand = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let i = 0; i < 300; i++) {
      const r = pickBars(steps, rand)!;
      expect(steps).toContain(r.last);
      expect(steps).toContain(r.first);
    }
  });

  it('trims a window that would end in silence back to the last note bar', () => {
    // length 8 (rand 0.999999), bars 1-5 then silence: only start 1 has 5 note bars; window 1..8 ends at 5
    expect(pickBars([1, 2, 3, 4, 5, 20], () => 0.999999)).toEqual({ first: 1, last: 5 });
  });

  it('skips starts that do not reach 5 note bars in the window', () => {
    // length 5: windows starting at 1 or 3 hold fewer than 5 note bars; only the cluster at 10 qualifies
    const steps = [1, 3, 10, 11, 12, 13, 14];
    expect(pickBars(steps, () => 0)).toEqual({ first: 10, last: 14 });
  });

  it('falls back to min..largest note bar within min+7 when no window has 5 note bars', () => {
    const steps = [1, 4, 8, 12, 16, 20];
    expect(pickBars(steps, () => 0)).toEqual({ first: 1, last: 8 });
  });

  it('a piece under 5 bars returns the whole span', () => {
    expect(pickBars([7, 3, 5], () => 0.5)).toEqual({ first: 3, last: 7 });
    expect(pickBars([4], () => 0)).toEqual({ first: 4, last: 4 });
  });
});
