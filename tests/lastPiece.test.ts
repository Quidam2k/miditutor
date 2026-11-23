import { describe, expect, it } from 'vitest';
import { rememberRef, resolvePieceId } from '../src/renderer/components/score/lastPiece';

const BUILT_IN = [{ id: 'minuet', label: 'Minuet in G' }];
const FOLDER = [
  ...BUILT_IN,
  { id: 'file:sorcerers-apprentice.musicxml', label: "The Sorcerer's Apprentice" },
];

describe('resolvePieceId (#10160)', () => {
  it('nothing saved: the default', () => {
    expect(resolvePieceId(null, BUILT_IN, false, 'minuet')).toBe('minuet');
  });

  it('a built-in piece is there at once', () => {
    expect(resolvePieceId({ id: 'minuet', label: 'Minuet in G' }, BUILT_IN, false, 'x')).toBe('minuet');
  });

  it('a library piece waits for the folder, then opens', () => {
    const saved = { id: 'file:sorcerers-apprentice.musicxml', label: "The Sorcerer's Apprentice" };
    expect(resolvePieceId(saved, BUILT_IN, false, 'minuet')).toBe('wait');
    expect(resolvePieceId(saved, FOLDER, true, 'minuet')).toBe('file:sorcerers-apprentice.musicxml');
  });

  it('a saved .pre-* backup comes back as its live file (#6654, asg 14109)', () => {
    // His Mac's 11/21 build saved the backup as his piece; the backup is no longer listed.
    const saved = { id: 'file:sorcerers-apprentice.pre-b3-4-fix.musicxml', label: 'Renamed title' };
    expect(resolvePieceId(saved, FOLDER, true, 'minuet')).toBe('file:sorcerers-apprentice.musicxml');
  });

  it('backup ids it does not map fall back by title (dotted or doubled suffix)', () => {
    for (const id of ['file:sorcerers-apprentice.pre-1.2.musicxml', 'file:sorcerers-apprentice.pre-a.pre-b.musicxml']) {
      expect(resolvePieceId({ id, label: "The Sorcerer's Apprentice" }, FOLDER, true, 'minuet')).toBe('file:sorcerers-apprentice.musicxml');
    }
  });

  it('a backup whose live file is gone falls back by title, then the default', () => {
    expect(resolvePieceId({ id: 'file:gone.pre-x.musicxml', label: "The Sorcerer's Apprentice" }, FOLDER, true, 'minuet'))
      .toBe('file:sorcerers-apprentice.musicxml');
    expect(resolvePieceId({ id: 'file:gone.pre-x.musicxml', label: 'Gone' }, FOLDER, true, 'minuet')).toBe('minuet');
  });

  it('a missing file falls back to the default, no error', () => {
    const saved = { id: 'file:gone.musicxml', label: 'Gone' };
    expect(resolvePieceId(saved, FOLDER, true, 'minuet')).toBe('minuet');
  });

  it('a piece the tutor pushed comes back by title from the folder', () => {
    const saved = { id: 'pushed:3', label: "The Sorcerer's Apprentice" };
    expect(resolvePieceId(saved, FOLDER, true, 'minuet')).toBe('file:sorcerers-apprentice.musicxml');
  });

  it('a pushed score is remembered as the file it was saved to', () => {
    expect(rememberRef('pushed-2', 'Backwards (e2e)', true)).toEqual({
      id: 'file:Backwards (e2e).musicxml', label: 'Backwards (e2e)',
    });
    expect(rememberRef('pushed-3', 'Photo only', false)).toEqual({ id: 'pushed-3', label: 'Photo only' });
    expect(rememberRef('file:x.musicxml', 'X', true).id).toBe('file:x.musicxml');
  });
});
