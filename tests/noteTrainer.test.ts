import { describe, it, expect } from 'vitest';
import {
  NOTE_RANGE, TIME_CAP_MS, notePool, recordAnswer, noteWeight, pickNext, slowestNotes,
  recordDay, parseNoteStats, parseDayTally, NoteStat, NoteStats, DayTally,
  TRAINER_KEYS, keyPool, pickInKey, pickKey,
} from '../src/renderer/engine/NoteTrainer';
import { printedAccidental } from '../src/renderer/engine/MusicTheory';

const ids = (clef: 'treble' | 'bass' | 'both', acc: boolean) => notePool(clef, acc).map((n) => n.id);
const stat = (over: Partial<NoteStat> = {}): NoteStat => ({ attempts: 10, hits: 10, avgMs: 1000, recent: [], ...over });
// Small LCG so the statistical tests are deterministic.
const lcg = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const seenStats = (pool: { id: string }[], avgMs: number): NoteStats =>
  Object.fromEntries(pool.map((n) => [n.id, stat({ avgMs, recent: [true, true] })]));
const counts = (pool: { id: string }[], stats: NoteStats, picks: number, seed = 7) => {
  const rand = lcg(seed);
  const c: Record<string, number> = Object.fromEntries(pool.map((n) => [n.id, 0]));
  for (let i = 0; i < picks; i++) c[pickNext(pool as ReturnType<typeof notePool>, stats, undefined, rand).id]++;
  return c;
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('notePool', () => {
  it('stays inside each clef range, naturals only when accidentals are off', () => {
    for (const clef of ['treble', 'bass'] as const) {
      const pool = notePool(clef, false);
      const [lo, hi] = NOTE_RANGE[clef];
      const midis = pool.map((n) => n.pitch.midiNumber);
      expect(Math.min(...midis)).toBe(lo);
      expect(Math.max(...midis)).toBe(hi);
      expect(pool.every((n) => n.clef === clef && !n.pitch.accidental)).toBe(true);
    }
  });

  it('has both spellings of each black key with accidentals on', () => {
    const treble = notePool('treble', true);
    const f4s = treble.filter((n) => n.pitch.midiNumber === 66);
    expect(f4s.map((n) => n.id).sort()).toEqual(['treble:F#4', 'treble:Gb4']);
    expect(ids('treble', true)).not.toContain('treble:E#4');
    for (const bad of ['E#', 'Cb', 'B#', 'Fb']) {
      expect(ids('both', true).some((id) => id.split(':')[1].startsWith(bad))).toBe(false);
    }
  });

  it("'both' has middle C once per clef and every id is unique", () => {
    for (const acc of [false, true]) {
      const all = ids('both', acc);
      expect(all.filter((id) => id.endsWith(':C4')).sort()).toEqual(['bass:C4', 'treble:C4']);
      expect(new Set(all).size).toBe(all.length);
      expect(all.slice(0, notePool('treble', acc).length).every((id) => id.startsWith('treble:'))).toBe(true);
    }
  });
});

describe('recordAnswer', () => {
  it('does not mutate its input', () => {
    const before: NoteStats = { 'treble:C4': stat({ recent: [true] }) };
    const snap = JSON.stringify(before);
    const after = recordAnswer(before, 'treble:C4', false, 500);
    expect(JSON.stringify(before)).toBe(snap);
    expect(after).not.toBe(before);
    expect(after['treble:C4']).not.toBe(before['treble:C4']);
  });

  it('first timed hit sets avgMs, then EWMA 0.3 new / 0.7 old', () => {
    let s = recordAnswer({}, 'a', true, 1000);
    expect(s.a).toEqual({ attempts: 1, hits: 1, avgMs: 1000, recent: [true] });
    s = recordAnswer(s, 'a', true, 2000);
    expect(s.a.avgMs).toBeCloseTo(0.3 * 2000 + 0.7 * 1000);
  });

  it('a miss or a null time leaves avgMs alone (null time still counts the hit)', () => {
    let s = recordAnswer({}, 'a', true, 1000);
    s = recordAnswer(s, 'a', false, 50);
    expect(s.a.avgMs).toBe(1000);
    s = recordAnswer(s, 'a', true, null);
    expect(s.a).toMatchObject({ attempts: 3, hits: 2, avgMs: 1000 });
  });

  it('caps time at TIME_CAP_MS and treats negative as 0', () => {
    expect(recordAnswer({}, 'a', true, 60000).a.avgMs).toBe(TIME_CAP_MS);
    expect(recordAnswer({}, 'a', true, -5).a.avgMs).toBe(0);
  });

  it('keeps only the last 8 results', () => {
    let s: NoteStats = {};
    for (let i = 0; i < 12; i++) s = recordAnswer(s, 'a', i >= 10, null);
    expect(s.a.recent).toHaveLength(8);
    expect(s.a.recent.slice(-2)).toEqual([true, true]);
    expect(s.a.attempts).toBe(12);
  });
});

describe('noteWeight', () => {
  it('unseen is 3', () => {
    expect(noteWeight(undefined, 1000)).toBe(3);
    expect(noteWeight(stat({ attempts: 0, hits: 0, avgMs: null }), 1000)).toBe(3);
  });

  it('slow beats fast, and misses raise the weight', () => {
    expect(noteWeight(stat({ avgMs: 2000 }), 1000)).toBeGreaterThan(noteWeight(stat({ avgMs: 500 }), 1000));
    const clean = noteWeight(stat({ recent: [true, true, true, true] }), 1000);
    const missy = noteWeight(stat({ recent: [true, false, false, true] }), 1000);
    expect(clean).toBeCloseTo(1);
    expect(missy).toBeCloseTo(3);
  });

  it('clamps the time factor at 0.25 and 6, and has fallbacks', () => {
    expect(noteWeight(stat({ avgMs: 1 }), 1000)).toBe(0.25);
    expect(noteWeight(stat({ avgMs: 100000 }), 1000)).toBe(6);
    expect(noteWeight(stat({ avgMs: null }), 1000)).toBe(2);
    expect(noteWeight(stat({ avgMs: 500 }), null)).toBe(1);
    expect(noteWeight(stat({ avgMs: 500 }), 0)).toBe(1);
  });
});

describe('pickNext', () => {
  const pool = notePool('treble', false);

  it('never returns avoidId', () => {
    for (let i = 0; i < 2000; i++) expect(pickNext(pool, {}, pool[3].id).id).not.toBe(pool[3].id);
  });

  it('returns the only item even when avoided; throws on an empty pool', () => {
    expect(pickNext([pool[0]], {}, pool[0].id)).toBe(pool[0]);
    expect(() => pickNext([], {})).toThrow();
  });

  it('survives rand at both extremes, calling it once', () => {
    let calls = 0;
    for (const r of [0, 0.999999]) {
      expect(pool).toContain(pickNext(pool, {}, undefined, () => (calls++, r)));
    }
    expect(calls).toBe(2);
  });

  it('a note 3x slower than the rest comes up at least 3x as often as the average other', () => {
    const stats = seenStats(pool, 1000);
    const slow = pool[5].id;
    stats[slow] = stat({ avgMs: 3000, recent: [true, true] });
    const c = counts(pool, stats, 5000);
    const others = pool.filter((n) => n.id !== slow).map((n) => c[n.id]);
    expect(c[slow]).toBeGreaterThanOrEqual(3 * mean(others));
  });

  it('an unseen note comes up more than an equally placed average seen note', () => {
    const stats = seenStats(pool, 1000);
    const unseen = pool[2].id;
    delete stats[unseen];
    const c = counts(pool, stats, 5000);
    const others = pool.filter((n) => n.id !== unseen).map((n) => c[n.id]);
    expect(c[unseen]).toBeGreaterThan(mean(others));
  });
});

describe('slowestNotes', () => {
  const stats: NoteStats = {
    'treble:C4': stat({ avgMs: 800, attempts: 4, hits: 3 }),
    'bass:Gb2': stat({ avgMs: 2500, attempts: 10, hits: 5 }),
    'treble:D4': stat({ avgMs: null }),
    'junk': stat({ avgMs: 9999 }),
    'treble:E4': stat({ avgMs: 1500 }),
  };

  it('orders slowest first, skips null and malformed ids, and limits', () => {
    expect(slowestNotes(stats, 10).map((s) => s.id)).toEqual(['bass:Gb2', 'treble:E4', 'treble:C4']);
    expect(slowestNotes(stats, 2)).toHaveLength(2);
  });

  it('reports name, clef, hit rate and attempts', () => {
    expect(slowestNotes(stats, 1)[0]).toEqual({ id: 'bass:Gb2', name: 'Gb2', clef: 'bass', avgMs: 2500, hitRate: 0.5, attempts: 10 });
  });
});

describe('recordDay', () => {
  it('accumulates, and misses add no time', () => {
    let t: DayTally | null = recordDay(null, '2026-10-30', true, 1000);
    t = recordDay(t, '2026-10-30', false, 4000);
    t = recordDay(t, '2026-10-30', true, 60000);
    t = recordDay(t, '2026-10-30', true, null);
    expect(t).toEqual({ day: '2026-10-30', attempts: 4, hits: 3, hitMs: 1000 + TIME_CAP_MS, timedHits: 2 });
  });

  it('starts over on a new day', () => {
    const t = recordDay({ day: '2026-10-29', attempts: 9, hits: 9, hitMs: 9000, timedHits: 9 }, '2026-10-30', false, null);
    expect(t).toEqual({ day: '2026-10-30', attempts: 1, hits: 0, hitMs: 0, timedHits: 0 });
  });
});

describe('parseNoteStats / parseDayTally', () => {
  it('returns {} for non-objects', () => {
    for (const raw of [null, [], 'x', 5, undefined]) expect(parseNoteStats(raw)).toEqual({});
  });

  it('keeps a good entry and drops bad ones', () => {
    const good = { attempts: 5, hits: 4, avgMs: 900, recent: [true, false] };
    const out = parseNoteStats({
      good: { ...good, extra: 1 },
      moreHits: { ...good, hits: 6 },
      negative: { ...good, attempts: -1 },
      strMs: { ...good, avgMs: '900' },
      nullMs: { ...good, avgMs: null },
    });
    expect(out.good).toEqual(good);
    expect(Object.keys(out).sort()).toEqual(['good', 'nullMs']);
  });

  it('truncates recent to 8, and ignores __proto__', () => {
    const recent = Array.from({ length: 12 }, (_, i) => i % 2 === 0);
    const out = parseNoteStats(JSON.parse(`{"a":{"attempts":12,"hits":6,"avgMs":null,"recent":${JSON.stringify(recent)}},"__proto__":{"attempts":1,"hits":1,"avgMs":null,"recent":[]}}`));
    expect(out.a.recent).toEqual(recent.slice(-8));
    expect(Object.keys(out)).toEqual(['a']);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });

  it('parseDayTally accepts a valid tally and rejects the rest', () => {
    const t = { day: '2026-10-30', attempts: 3, hits: 2, hitMs: 1500, timedHits: 2 };
    expect(parseDayTally(t)).toEqual(t);
    expect(parseDayTally(null)).toBeNull();
    expect(parseDayTally('x')).toBeNull();
    expect(parseDayTally({ ...t, day: 5 })).toBeNull();
    expect(parseDayTally({ ...t, hits: -1 })).toBeNull();
    expect(parseDayTally({ ...t, hitMs: NaN })).toBeNull();
    expect(parseDayTally({ ...t, timedHits: undefined })).toBeNull();
  });
});

describe('keys (#10262)', () => {
  it('has 11 keys, none needing a spelling outside the pool', () => {
    expect(TRAINER_KEYS).toHaveLength(11);
    for (const key of TRAINER_KEYS) {
      const { inKey } = keyPool('treble', key);
      const pcs = new Set(inKey.map((n) => n.pitch.midiNumber % 12));
      expect(pcs.size, key.name).toBe(7);
    }
  });

  it("D major: F#4 is in the key and prints bare; F4 prints a natural; Gb4 never comes up", () => {
    const D = TRAINER_KEYS.find((k) => k.name === 'D')!;
    const { inKey, outOfKey } = keyPool('treble', D);
    const fs4 = inKey.find((n) => n.id === 'treble:F#4')!;
    expect(printedAccidental(fs4.pitch, D.fifths)).toBeNull();
    const f4 = outOfKey.find((n) => n.id === 'treble:F4')!;
    expect(printedAccidental(f4.pitch, D.fifths)).toBe('n');
    expect([...inKey, ...outOfKey].some((n) => n.id === 'treble:Gb4')).toBe(false);
    expect(inKey.some((n) => n.id === 'treble:F4')).toBe(false);
  });

  it('C major: a black key prints its sharp or flat; a flat key prints naturals', () => {
    const C = TRAINER_KEYS.find((k) => k.name === 'C')!;
    const out = keyPool('treble', C).outOfKey;
    expect(out.map((n) => n.id)).toContain('treble:Db4');
    expect(printedAccidental(out.find((n) => n.id === 'treble:C#4')!.pitch, 0)).toBe('#');
    const Eb = TRAINER_KEYS.find((k) => k.name === 'Eb')!;
    const b4 = keyPool('treble', Eb).outOfKey.find((n) => n.id === 'treble:B4')!;
    expect(printedAccidental(b4.pitch, Eb.fifths)).toBe('n');
  });

  it('every key: in-key notes print nothing, out-of-key notes print something, no pitch is in both', () => {
    for (const key of TRAINER_KEYS) {
      const { inKey, outOfKey } = keyPool('both', key);
      expect(inKey.every((n) => printedAccidental(n.pitch, key.fifths) === null)).toBe(true);
      expect(outOfKey.every((n) => printedAccidental(n.pitch, key.fifths) !== null)).toBe(true);
      const inPcs = new Set(inKey.map((n) => n.pitch.midiNumber % 12));
      expect(outOfKey.some((n) => inPcs.has(n.pitch.midiNumber % 12))).toBe(false);
    }
  });

  it('draws about 80% in the key', () => {
    const D = TRAINER_KEYS.find((k) => k.name === 'D')!;
    const inIds = new Set(keyPool('treble', D).inKey.map((n) => n.id));
    const rand = lcg(11);
    let hits = 0;
    for (let i = 0; i < 5000; i++) if (inIds.has(pickInKey('treble', D, {}, undefined, rand).id)) hits++;
    expect(hits / 5000).toBeGreaterThan(0.77);
    expect(hits / 5000).toBeLessThan(0.83);
  });

  it('pickKey never repeats the key it was told to avoid', () => {
    const D = TRAINER_KEYS[2];
    for (const r of [0, 0.5, 0.999999]) expect(pickKey(D, () => r).name).not.toBe(D.name);
  });
});
