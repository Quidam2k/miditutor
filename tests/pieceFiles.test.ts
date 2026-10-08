import { describe, expect, it } from 'vitest';
import { isScoreXml, titleFromPath } from '../src/shared/pieceFiles';

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
