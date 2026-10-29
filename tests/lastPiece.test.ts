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
