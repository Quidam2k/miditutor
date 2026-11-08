import { describe, it, expect } from 'vitest';
import { LADDER_FAST_MS, isKnown, ladderLevel, ladderOrder, landmarkCount, parseLadder } from '../src/renderer/engine/Ladder';
import { NoteStat, NoteStats, notePool } from '../src/renderer/engine/NoteTrainer';

const known = (over: Partial<NoteStat> = {}): NoteStat => ({ attempts: 5, hits: 5, avgMs: 1500, recent: [true, true, true], ...over });
const ids = (clef: 'treble' | 'bass' | 'both', k: number) => ladderOrder(clef).slice(0, k).map((n) => n.id);
const allKnown = (list: string[]): NoteStats => Object.fromEntries(list.map((id) => [id, known()]));

describe('ladder', () => {
  it('starts on the landmarks, then the notes a letter away', () => {
    expect(ids('treble', 3)).toEqual(['treble:C4', 'treble:G4', 'treble:C5']);
    expect(ids('treble', 7)).toEqual(['treble:C4', 'treble:G4', 'treble:C5', 'treble:D4', 'treble:F4', 'treble:A4', 'treble:B4']);
    expect(ids('bass', 3)).toEqual(['bass:C3', 'bass:F3', 'bass:C4']);
    expect(ids('both', 6)).toEqual(['treble:C4', 'treble:G4', 'treble:C5', 'bass:C3', 'bass:F3', 'bass:C4']);
  });

  it('orders every white key of the clef, once', () => {
    for (const clef of ['treble', 'bass', 'both'] as const) {
      expect(new Set(ladderOrder(clef).map((n) => n.id))).toEqual(new Set(notePool(clef, false).map((n) => n.id)));
    }
  });

  it('known = last 3 right and fast on average', () => {
    expect(isKnown(known())).toBe(true);
    expect(isKnown(undefined)).toBe(false);
    expect(isKnown(known({ recent: [true, true] }))).toBe(false);
    expect(isKnown(known({ recent: [false, true, true, true] }))).toBe(true);
    expect(isKnown(known({ recent: [true, false, true] }))).toBe(false);
    expect(isKnown(known({ avgMs: LADDER_FAST_MS + 1 }))).toBe(false);
    expect(isKnown(known({ avgMs: null }))).toBe(false);
  });

  it('adds one note when the set is known, and stops at the first note not known yet', () => {
    expect(ladderLevel('treble', {})).toBe(3);
    expect(ladderLevel('treble', allKnown(ids('treble', 2)))).toBe(3);
    expect(ladderLevel('treble', allKnown(ids('treble', 3)))).toBe(4);
    expect(ladderLevel('treble', allKnown(ids('treble', 5)))).toBe(6);
  });

  it('never goes down: a later miss keeps the stored level', () => {
    const stats = { ...allKnown(ids('treble', 5)), 'treble:C4': known({ recent: [true, true, false] }) };
    expect(ladderLevel('treble', stats, 6)).toBe(6);
    expect(ladderLevel('treble', {}, 99)).toBe(ladderOrder('treble').length);
    expect(landmarkCount('both')).toBe(6);
  });

  it('parses stored levels, dropping junk', () => {
    expect(parseLadder({ treble: 5, bass: -1, both: 2.5, extra: 3 })).toEqual({ treble: 5 });
    expect(parseLadder(null)).toEqual({});
    expect(parseLadder([4])).toEqual({});
  });
});
