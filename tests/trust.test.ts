import { describe, expect, it } from 'vitest';
import { parseTrust, trustBadge, trustFor, trustMark } from '../src/shared/trust';

describe('parseTrust', () => {
  it('returns an empty map for anything that is not an object', () => {
    expect(parseTrust(null)).toEqual({});
    expect(parseTrust([])).toEqual({});
    expect(parseTrust('text')).toEqual({});
    expect(parseTrust(42)).toEqual({});
  });

  it('keeps valid entries, defaults a missing note, and drops bad statuses', () => {
    const map = parseTrust({
      'a.musicxml': { status: 'checked', note: 'checked against the page', source: 'omr_audit' },
      'b.musicxml': { status: 'issues', note: 7 },
      'c.musicxml': { status: 'maybe', note: 'x' },
      'd.musicxml': 'nope',
    });
    expect(map).toEqual({
      'a.musicxml': { status: 'checked', note: 'checked against the page' },
      'b.musicxml': { status: 'issues', note: '' },
    });
  });
});

describe('trustFor', () => {
  const map = parseTrust({ 'a.musicxml': { status: 'unverified', note: '' } });

  it('looks up only the file itself', () => {
    expect(trustFor(map, 'a.musicxml')).toEqual({ status: 'unverified', note: '' });
    expect(trustFor(map, 'missing.musicxml')).toBeUndefined();
    expect(trustFor(map, 'constructor')).toBeUndefined();
    expect(trustFor(undefined, 'a.musicxml')).toBeUndefined();
  });
});

describe('trust badge text', () => {
  it('marks each status with a symbol', () => {
    expect(trustMark({ status: 'checked', note: '' })).toBe('✓');
    expect(trustMark({ status: 'issues', note: 'x' })).toBe('⚠');
    expect(trustMark({ status: 'unverified', note: '' })).toBe('?');
    expect(trustMark(undefined)).toBe('?');
  });

  it('says what is known in plain words', () => {
    expect(trustBadge({ status: 'checked', note: '' })).toBe('Checked against the page');
    expect(trustBadge({ status: 'issues', note: 'timing off in bars 4-7' })).toBe(
      'Known issues: timing off in bars 4-7',
    );
    expect(trustBadge({ status: 'issues', note: '  ' })).toBe('Known issues');
    expect(trustBadge({ status: 'unverified', note: '' })).toBe('Not yet checked');
    expect(trustBadge(undefined)).toBe('Not yet checked');
  });
});
