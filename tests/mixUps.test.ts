import { describe, it, expect } from 'vitest';
import {
  recordMixUp, recordRight, liveMixUps, mixUpKind, mixUpLabel, playedClef,
  drillPool, parseMixUps, CLEARED_AFTER, MAX_PAIRS, MixUp, MixUps,
} from '../src/renderer/engine/MixUps';

const day = '2026-11-08';
const key = 'bass:G2>E4';
const pair = (over: Partial<MixUp> = {}): MixUp =>
  ({ asked: 'bass:G2', played: 'E4', count: 2, since: 0, last: day, ...over });
const isoDay = (i: number) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);

describe('mix-ups', () => {
  it('records new and repeated mistakes without mutating the input', () => {
    const empty: MixUps = {};
    const first = recordMixUp(empty, 'bass:G2', 'E4', '2026-11-01');
    expect(first[key]).toEqual(pair({ count: 1, last: '2026-11-01' }));
    expect(empty).toEqual({});
    const before = recordRight(first, 'bass:G2');
    const snapshot = JSON.stringify(before);
    const after = recordMixUp(before, 'bass:G2', 'E4', day);
    expect(after[key]).toEqual(pair());
    expect(before[key].since).toBe(1);
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(after).not.toBe(before);
  });

  it('increments since only for matching asked ids and preserves identity on no match', () => {
    const before = { a: pair(), b: pair({ played: 'D4', since: 2 }), c: pair({ asked: 'treble:C4' }) };
    const after = recordRight(before, 'bass:G2');
    expect([after.a.since, after.b.since, after.c.since]).toEqual([1, 3, 0]);
    expect([before.a.since, before.b.since, before.c.since]).toEqual([0, 2, 0]);
    expect(recordRight(before, 'treble:A4')).toBe(before);
  });

  it('hides single and cleared mistakes and sorts by count then latest day', () => {
    expect(CLEARED_AFTER).toBe(5);
    const older = pair({ last: '2026-11-01' }), newer = pair(), most = pair({ count: 3, last: '2026-01-01' });
    expect(liveMixUps({
      once: pair({ count: 1 }), cleared: pair({ since: CLEARED_AFTER }),
      beyond: pair({ since: CLEARED_AFTER + 1 }), older, most, newer,
    })).toEqual([most, newer, older]);
  });

  it('becomes live, clears after five right answers, and becomes live again on a mistake', () => {
    let mix = recordMixUp({}, 'bass:G2', 'E4', day);
    mix = recordMixUp(mix, 'bass:G2', 'E4', day);
    expect(liveMixUps(mix)).toEqual([mix[key]]);
    for (let i = 0; i < 5; i++) mix = recordRight(mix, 'bass:G2');
    expect(liveMixUps(mix)).toEqual([]);
    mix = recordMixUp(mix, 'bass:G2', 'E4', day);
    expect(liveMixUps(mix)).toEqual([pair({ count: 3 })]);
  });

  it('caps MAX_PAIRS, keeping the newest pair and dropping the oldest day', () => {
    let mix: MixUps = {};
    for (let i = 0; i <= MAX_PAIRS; i++) mix = recordMixUp(mix, 'bass:G2', `C${i}`, isoDay(i));
    expect(Object.keys(mix)).toHaveLength(MAX_PAIRS);
    expect(mix[`bass:G2>C${MAX_PAIRS}`]).toEqual(pair({ played: `C${MAX_PAIRS}`, count: 1, last: isoDay(MAX_PAIRS) }));
    expect(mix).not.toHaveProperty('bass:G2>C0');
  });

  it.each([
    ['bass:G2', 'E4', 'other-clef'], ['bass:G2', 'E3', 'other-clef'],
    ['treble:A4', 'C3', 'other-clef'], ['treble:C4', 'E2', 'other-clef'],
    ['treble:G4', 'G5', 'octave'], ['treble:G4', 'A4', 'step'],
    ['treble:G4', 'F#4', 'step'], ['treble:G4', 'B4', 'third'],
    ['treble:G4', 'B3', 'other-clef'], ['bass:G2', 'E2', 'third'],
    ['treble:G4', 'D5', 'other'], ['nonsense', 'E4', 'other'],
  ])('classifies %s played as %s as %s', (asked, played, kind) => {
    expect(mixUpKind(asked, played)).toBe(kind);
  });

  it('labels other-clef mistakes and chooses a clef only within its range', () => {
    expect(mixUpLabel('other-clef', 'bass')).toBe('read as treble clef');
    expect(mixUpLabel('other', 'bass')).toBe('');
    expect(playedClef(64, 'bass')).toBe('treble');
    expect(playedClef(60, 'bass')).toBe('bass');
    for (const midi of [30, 100]) expect(playedClef(midi, 'bass')).toBeNull();
  });

  it('builds a drill pool with correct pitches, range checks, deduplication and accidentals', () => {
    const pool = drillPool(liveMixUps({ [key]: pair() }));
    expect(pool.map((n) => n.id)).toEqual(['bass:G2', 'treble:E4']);
    expect(pool.map((n) => n.pitch.midiNumber)).toEqual([43, 64]);
    expect(drillPool([pair({ played: 'C7' })]).map((n) => n.id)).toEqual(['bass:G2']);
    const shared = drillPool([pair(), pair({ played: 'D4' })]);
    expect(shared.map((n) => n.id)).toEqual(['bass:G2', 'treble:E4', 'treble:D4']);
    const sharp = drillPool([pair({ asked: 'treble:F#4', played: 'Gb4' })]);
    expect(sharp[0]).toMatchObject({ id: 'treble:F#4', pitch: { accidental: 'sharp', midiNumber: 66 } });
  });

  it('parses only valid entries and copies only the five allowed fields', () => {
    const good = pair();
    expect(parseMixUps({ [key]: { ...good, extra: 1 } })).toEqual({ [key]: good });
    expect(parseMixUps({ mismatch: good })).toEqual({});
    for (const bad of [pair({ count: 0 }), pair({ since: -1 }), pair({ played: 'bad' })]) {
      expect(parseMixUps({ [`${bad.asked}>${bad.played}`]: bad })).toEqual({});
    }
    const raw = JSON.parse('{"__proto__":{"asked":"bass:G2","played":"E4","count":2,"since":0,"last":"2026-11-08"}}');
    const parsed = parseMixUps(raw);
    expect(Object.keys(parsed)).toEqual([]);
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    for (const value of [null, [], 'x']) expect(parseMixUps(value)).toEqual({});
  });
});
