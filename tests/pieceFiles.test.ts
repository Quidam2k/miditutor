import { describe, expect, it } from 'vitest';
import { isPieceFileName, isScoreXml, pieceFileName, pieceTitle, scoreTitle, titleFromPath } from '../src/shared/pieceFiles';

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

  it('skips .pre-<fix> backups but not titles that merely contain "pre" (#6654)', () => {
    expect(isPieceFileName('sorcerers-apprentice.pre-b3-4-fix.musicxml')).toBe(false);
    expect(isPieceFileName('sorcerers-apprentice.pre-annotate.musicxml')).toBe(false);
    expect(isPieceFileName('Prelude in C.musicxml')).toBe(true);
    expect(isPieceFileName('pre-war-blues.musicxml')).toBe(true);
    expect(isPieceFileName('The Sorcerer\'s Apprentice.musicxml')).toBe(true);
  });
});

describe('pieceFileName', () => {
  it('makes a safe .musicxml name from a title', () => {
    expect(pieceFileName("The Sorcerer's Apprentice")).toBe("The Sorcerer's Apprentice.musicxml");
    expect(pieceFileName('a/b:c?')).toBe('a b c.musicxml');
    expect(pieceFileName('../..')).toBe('Untitled.musicxml');
  });
});

describe('pieceTitle (#6368)', () => {
  const xml = (t: string) => `<work><work-title>${t}</work-title></work>`;
  it('uses the file name when the score title is just its first word', () => {
    expect(pieceTitle(xml('Spin'), 'Spin the Wheel (intermediate).musicxml')).toBe('Spin the Wheel (intermediate)');
  });
  it('keeps a real score title, even when the file name differs', () => {
    expect(pieceTitle(xml('The Stormy Sea'), 'the-stormy-sea.musicxml')).toBe('The Stormy Sea');
    expect(pieceTitle(xml('Spin the Wheel'), 'spin.musicxml')).toBe('Spin the Wheel');
    expect(pieceTitle(xml('Fur Elise'), 'fur-elise-easy.musicxml')).toBe('Fur Elise');
  });
  it('falls back to the file name with no title', () => {
    expect(pieceTitle('<score-partwise/>', 'Minuet in G.musicxml')).toBe('Minuet in G');
  });
});
