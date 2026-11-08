import { describe, it, expect } from 'vitest';
import {
  DUE_SHARE, MAX_INTERVAL_DAYS, REVIEW_FAST_MS, addDays, dueNotes, isDue, parseReview, pickWithReview, recordReview, ReviewSchedule,
} from '../src/renderer/engine/Review';
import { notePool } from '../src/renderer/engine/NoteTrainer';

const T = '2026-11-08';
const G = 'treble:G4';

describe('across-days review', () => {
  it('adds days across month and year ends', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 2)).toBe('2027-01-02');
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
  });

  it('pushes a fast right out 1, 2, 4 days, each time it comes due', () => {
    let s: ReviewSchedule = recordReview({}, G, true, 1000, T);
    expect(s[G]).toEqual({ interval: 1, due: '2026-11-09' });
    s = recordReview(s, G, true, 1000, '2026-11-09');
    expect(s[G]).toEqual({ interval: 2, due: '2026-11-11' });
    s = recordReview(s, G, true, REVIEW_FAST_MS, '2026-11-11');
    expect(s[G]).toEqual({ interval: 4, due: '2026-11-15' });
  });

  it('does not cram: a fast right before it is due changes nothing', () => {
    const s = recordReview({}, G, true, 1000, T);
    expect(recordReview(s, G, true, 900, T)).toBe(s);
  });

  it('caps the interval', () => {
    const s = recordReview({ [G]: { interval: 40, due: T } }, G, true, 800, T);
    expect(s[G].interval).toBe(MAX_INTERVAL_DAYS);
  });

  it('a wrong makes it due today and resets it', () => {
    const s = recordReview({ [G]: { interval: 16, due: '2026-11-20' } }, G, false, null, T);
    expect(s[G]).toEqual({ interval: 0, due: T });
    expect(isDue(s, G, T)).toBe(true);
  });

  it('a slow right pulls it in, never pushes it later', () => {
    const s = recordReview({ [G]: { interval: 8, due: '2026-11-30' } }, G, true, REVIEW_FAST_MS + 1, T);
    expect(s[G]).toEqual({ interval: 4, due: '2026-11-12' });
    const soon = recordReview({ [G]: { interval: 8, due: '2026-11-09' } }, G, true, 5000, T);
    expect(soon[G].due).toBe('2026-11-09');
    // Slow at interval 0 still leaves today, so one hard note can't loop.
    expect(recordReview({ [G]: { interval: 0, due: T } }, G, true, 5000, T)[G].due).toBe('2026-11-09');
  });

  it('an untimed right does not move it', () => {
    const s: ReviewSchedule = { [G]: { interval: 2, due: T } };
    expect(recordReview(s, G, true, null, T)).toBe(s);
  });

  it('picks due notes first, but not every time, and not the one just asked', () => {
    const pool = notePool('treble', false);
    const sched: ReviewSchedule = { [G]: { interval: 0, due: T }, 'treble:E4': { interval: 3, due: '2026-11-07' }, 'treble:A4': { interval: 2, due: '2026-11-09' } };
    expect(dueNotes(pool, sched, T).map((n) => n.id).sort()).toEqual(['treble:E4', G]);
    expect(pickWithReview(pool, {}, sched, T, G, () => 0)?.id).toBe('treble:E4');
    expect(pickWithReview(pool, {}, sched, T, undefined, () => DUE_SHARE)).toBeNull();
    expect(pickWithReview(pool, {}, { [G]: { interval: 0, due: T } }, T, G, () => 0)).toBeNull();
    expect(pickWithReview(pool, {}, {}, T, undefined, () => 0)).toBeNull();
  });

  it('keeps only well-formed stored entries', () => {
    const raw = JSON.parse('{"treble:G4":{"interval":2,"due":"2026-11-10"},"a":{"interval":-1,"due":"2026-11-10"},"b":{"interval":1.5,"due":"2026-11-10"},"c":{"interval":1,"due":"tomorrow"},"d":null,"__proto__":{"interval":1,"due":"2026-11-10"}}');
    expect(parseReview(raw)).toEqual({ 'treble:G4': { interval: 2, due: '2026-11-10' } });
    expect(parseReview([])).toEqual({});
    expect(parseReview(null)).toEqual({});
  });
});
