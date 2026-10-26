import { describe, expect, it } from 'vitest';
import { isPieceFileName, isScoreXml, pieceFileName, scoreTitle, titleFromPath } from '../src/shared/pieceFiles';

describe('isScoreXml', () => {
  it('accepts partwise and timewise scores', () => {
    expect(isScoreXml('<?xml version="1.0"?><score-partwise version="4.0">')).toBe(true);
    expect(isScoreXml('<score-timewise>')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isScoreXml('<invalid />')).toBe(false);
    expect(isScoreXml('')).toBe(false);
  });
});

describe('titleFromPath', () => {
  it('strips folders and the extension', () => {
    expect(titleFromPath(String.raw`C:\Users\Todd\Music\Minuet in G.musicxml`)).toBe('Minuet in G');
    expect(titleFromPath('/home/todd/score.mxl')).toBe('score');
  });

  it('falls back when there is no name', () => {
    expect(titleFromPath('.musicxml')).toBe('Untitled');
    expect(titleFromPath('')).toBe('Untitled');
  });
});

describe('scoreTitle', () => {
  it('prefers the work title, then the movement title', () => {
    expect(scoreTitle('<work><work-title>The Stormy Sea</work-title></work><movement-title>x</movement-title>')).toBe('The Stormy Sea');
    expect(scoreTitle('<movement-title>O (from O)</movement-title>')).toBe('O (from O)');
  });

  it('unescapes entities and returns null when there is no title', () => {
    expect(scoreTitle("<work-title>The Sorcerer&apos;s Apprentice</work-title>")).toBe("The Sorcerer's Apprentice");
    expect(scoreTitle('<work-title>  </work-title>')).toBeNull();
    expect(scoreTitle('<score-partwise/>')).toBeNull();
  });
});

describe('isPieceFileName', () => {
  it('lists score files and skips dot files and other types', () => {
    expect(isPieceFileName('o-from-o.musicxml')).toBe(true);
    expect(isPieceFileName('Song.MXL')).toBe(true);
    expect(isPieceFileName('._o-from-o.musicxml')).toBe(false);
    expect(isPieceFileName('notes.txt')).toBe(false);
  });
});

describe('pieceFileName', () => {
  it('makes a safe .musicxml name from a title', () => {
    expect(pieceFileName("The Sorcerer's Apprentice")).toBe("The Sorcerer's Apprentice.musicxml");
    expect(pieceFileName('a/b:c?')).toBe('a b c.musicxml');
    expect(pieceFileName('../..')).toBe('Untitled.musicxml');
  });
});
