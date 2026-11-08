// #11354: Verify fresh-tune selection, transposition, and MusicXML rhythm.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FRESH_KEYS,
  freshTuneXml,
  keyFifths,
  pickFreshTune,
  type FreshTune,
} from '../src/renderer/engine/FreshTune';

/** Make a small tune with replaceable notes and meter. */
function tune(
  notes: FreshTune['notes'] = [
    [0, 0, 2],
    [1, 0, 2],
    [2, 0, 2],
    [3, 0, 2],
    [4, 0, 8],
  ],
  meter = '4/4',
): FreshTune {
  return { id: 'test/0', title: '', mode: 'major', meter, notes };
}

/** Read emitted pitches without a browser DOM. */
function pitches(xml: string) {
  const pattern = /<pitch><step>([A-G])<\/step>(?:<alter>(-?\d+)<\/alter>)?<octave>(-?\d+)<\/octave><\/pitch>/g;
  return Array.from(xml.matchAll(pattern), match => ({
    step: match[1]!,
    alter: Number(match[2] ?? 0),
    octave: Number(match[3]),
  }));
}

/** Extract complete measure bodies. */
function measures(xml: string): string[] {
  return Array.from(
    xml.matchAll(/<measure\b[^>]*>([\s\S]*?)<\/measure>/g),
    match => match[1]!,
  );
}

describe('keyFifths', () => {
  it.each([
    ['C', 0],
    ['G', 1],
    ['F', -1],
    ['Bb', -2],
    ['a', 0],
    ['e', 1],
    ['d', -1],
    ['g', -2],
    ['c', -3],
    ['f#', 3],
  ] as const)('%s has %i fifths', (name, fifths) => {
    expect(keyFifths(name)).toBe(fifths);
  });
});

describe('pickFreshTune', () => {
  const seenMajor: FreshTune = { ...tune(), id: 'seen' };
  const minor: FreshTune = { ...tune(), id: 'minor', mode: 'minor' };
  const first: FreshTune = { ...tune(), id: 'first' };
  const second: FreshTune = { ...tune(), id: 'second' };
  const collection = [seenMajor, minor, first, second];

  it('skips seen IDs and the wrong mode with deterministic randomness', () => {
    expect(
      pickFreshTune(collection, 'major', new Set(['seen']), () => 0),
    ).toBe(first);
    expect(
      pickFreshTune(collection, 'minor', new Set(), () => 0),
    ).toBe(minor);
  });

  it('uses the injected random value among eligible tunes', () => {
    expect(
      pickFreshTune(collection, 'major', new Set(['seen']), () => 0.99),
    ).toBe(second);
  });

  it('returns null when that mode is exhausted', () => {
    expect(
      pickFreshTune(
        collection,
        'major',
        new Set(['seen', 'first', 'second']),
        () => 0,
      ),
    ).toBeNull();
    expect(pickFreshTune([], 'major', new Set(), () => 0)).toBeNull();
  });
});

describe('freshTuneXml', () => {
  it('renders C D E F G in C with a whole G in the second measure', () => {
    const xml = freshTuneXml(tune(), 'C', 'Fresh tune');
    const bars = measures(xml);

    expect(xml).toContain('<score-partwise version="3.1">');
    expect(xml).toContain('<part-name>Melody</part-name>');
    expect(xml).toContain('<divisions>2</divisions>');
    expect(xml).toContain('<clef><sign>G</sign><line>2</line></clef>');
    expect(pitches(xml).map(p => p.step)).toEqual(['C', 'D', 'E', 'F', 'G']);
    expect(xml).not.toContain('<alter>');
    expect(bars).toHaveLength(2);
    expect(pitches(bars[1]!)).toHaveLength(1);
    expect(pitches(bars[1]!)[0]!.step).toBe('G');
    expect(bars[1]).toContain('<duration>8</duration><type>whole</type>');
    expect(bars[1]).toContain('<bar-style>light-heavy</bar-style>');
    expect(bars[0]).not.toContain('<barline');
  });

  it('transposes to G with one sharp in the signature', () => {
    const xml = freshTuneXml(tune(), 'G', 'Fresh tune');
    expect(pitches(xml).map(p => p.step)).toEqual(['G', 'A', 'B', 'C', 'D']);
    expect(xml).toContain('<fifths>1</fifths><mode>major</mode>');
    expect(xml).not.toContain('<alter>');
  });

  it('uses the signature for the fourth degree in F', () => {
    const xml = freshTuneXml(tune(), 'F', 'Fresh tune');
    expect(pitches(xml)[3]).toMatchObject({ step: 'B', alter: -1 });
    expect(xml).toContain('<alter>-1</alter>');
    expect(xml).not.toContain('<accidental>');
  });

  it('renders a raised fourth degree in C with an explicit sharp', () => {
    const xml = freshTuneXml(tune([[3, 1, 2]]), 'C', 'Fresh tune');
    expect(pitches(xml)[0]).toMatchObject({ step: 'F', alter: 1 });
    expect(xml).toContain('<accidental>sharp</accidental>');
  });

  it('renders natural and flat alterations explicitly', () => {
    const natural = freshTuneXml(tune([[6, 1, 2]]), 'F', 'Natural');
    expect(pitches(natural)[0]).toMatchObject({ step: 'E', alter: 1 });
    expect(natural).toContain('<accidental>sharp</accidental>');

    const cancelled = freshTuneXml(tune([[3, 1, 2]]), 'F', 'Natural');
    expect(pitches(cancelled)[0]).toMatchObject({ step: 'B', alter: 0 });
    expect(cancelled).toContain('<accidental>natural</accidental>');

    const flat = freshTuneXml(tune([[2, -1, 2]]), 'C', 'Flat');
    expect(pitches(flat)[0]).toMatchObject({ step: 'E', alter: -1 });
    expect(flat).toContain('<accidental>flat</accidental>');
  });

  it('renders a three-eighth duration as a dotted quarter', () => {
    const xml = freshTuneXml(tune([[0, 0, 3]]), 'C', 'Dotted');
    expect(xml).toContain(
      '<duration>3</duration><type>quarter</type><dot/>',
    );
    expect(xml).not.toContain('<tie ');
  });

  it('splits five eighths within one measure into tied half and eighth', () => {
    const xml = freshTuneXml(tune([[0, 0, 5]]), 'C', 'Five');
    expect(measures(xml)).toHaveLength(1);
    expect(Array.from(xml.matchAll(/<duration>(\d+)<\/duration>/g),
      match => Number(match[1]))).toEqual([4, 1]);
    expect(xml).toContain('<type>half</type>');
    expect(xml).toContain('<type>eighth</type>');
    expect(xml.match(/<tie\b/g)).toHaveLength(2);
    expect(xml).toContain('<tie type="start"/>');
    expect(xml).toContain('<tie type="stop"/>');
    expect(xml).toContain('<notations><tied type="start"/></notations>');
    expect(xml).toContain('<notations><tied type="stop"/></notations>');
  });

  it('splits a note crossing a barline and emits both tie endpoints', () => {
    const xml = freshTuneXml(
      tune([[0, 0, 6], [1, 0, 4]]),
      'C',
      'Across the bar',
    );
    const bars = measures(xml);
    expect(bars).toHaveLength(2);
    expect(bars[0]).toContain('<tie type="start"/>');
    expect(bars[1]).toContain('<tie type="stop"/>');
    expect(xml.match(/<tie\b/g)).toHaveLength(2);
    expect(pitches(xml).map(p => p.step)).toEqual(['C', 'D', 'D']);
    expect(Array.from(xml.matchAll(/<duration>(\d+)<\/duration>/g),
      match => Number(match[1]))).toEqual([6, 2, 2]);
  });

  it('preserves source ties between consecutive notes', () => {
    const xml = freshTuneXml(
      tune([[0, 0, 2, 1], [0, 0, 2]]),
      'C',
      'Source tie',
    );
    expect(xml.match(/<tie\b/g)).toHaveLength(2);
    expect(xml).toContain('<tie type="start"/>');
    expect(xml).toContain('<tie type="stop"/>');
  });

  it('splits twelve eighths into whole and half rather than dotted whole', () => {
    const xml = freshTuneXml(tune([[0, 0, 12]]), 'C', 'Long');
    expect(measures(xml)).toHaveLength(2);
    expect(Array.from(xml.matchAll(/<duration>(\d+)<\/duration>/g),
      match => Number(match[1]))).toEqual([8, 4]);
    expect(xml).not.toContain('<dot/>');
    expect(xml.match(/<tie\b/g)).toHaveLength(2);
  });

  it('renders rests without pitches or ties', () => {
    const xml = freshTuneXml(tune([[null, 0, 10]]), 'C', 'Rest');
    expect(xml.match(/<rest\/>/g)).toHaveLength(2);
    expect(pitches(xml)).toEqual([]);
    expect(xml).not.toContain('<tie ');
  });

  it.each([
    ['2/4', 4, '2', '4'],
    ['3/4', 6, '3', '4'],
    ['4/4', 8, '4', '4'],
    ['6/8', 6, '6', '8'],
  ] as const)('fills %s measures correctly', (meter, length, beats, beatType) => {
    const xml = freshTuneXml(
      tune([[null, 0, length], [null, 0, length]], meter),
      'C',
      'Meter',
    );
    expect(measures(xml)).toHaveLength(2);
    expect(xml).toContain(
      `<time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>`,
    );
  });

  it('escapes the work title', () => {
    const xml = freshTuneXml(tune(), 'C', 'A & B < C > D');
    expect(xml).toContain(
      '<work-title>A &amp; B &lt; C &gt; D</work-title>',
    );
  });

  it('wraps negative degrees to the previous diatonic octave', () => {
    const xml = freshTuneXml(tune([[-1, 0, 2], [0, 0, 2]]), 'C', 'Below');
    const notes = pitches(xml);
    expect(notes.map(p => p.step)).toEqual(['B', 'C']);
    expect(notes[1]!.octave).toBe(notes[0]!.octave + 1);
  });

  it('never emits a pitch below MIDI 57 in any practice key', () => {
    const pc: Record<string, number> = {
      C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
    };
    for (const key of FRESH_KEYS) {
      const lowTune: FreshTune = {
        ...tune([[-6, -1, 2], [-4, 0, 2], [-2, 0, 2], [0, 0, 2]]),
        mode: key.mode,
      };
      const xml = freshTuneXml(lowTune, key.name, 'Low melody');
      const notes = pitches(xml);
      expect(notes).toHaveLength(4);
      expect(xml).toContain(`<mode>${key.mode}</mode>`);
      for (const p of notes) {
        const midi = 12 * (p.octave + 1) + pc[p.step]! + p.alter;
        expect(midi).toBeGreaterThanOrEqual(57);
      }
    }
  });
  it('cancels an accidental later in the bar and prints it again in the next bar', () => {
    // F# F | F# : in C, the second F needs a natural, the next bar's F# its sharp again.
    const xml = freshTuneXml(tune([[3, 1, 2], [3, 0, 6], [3, 1, 8]]), 'C', 'x');
    const [first, second] = measures(xml);
    const signs = (m: string) => Array.from(m.matchAll(/<accidental>([a-z-]+)<\/accidental>/g), (x) => x[1]);
    expect(signs(first!)).toEqual(['sharp', 'natural']);
    expect(signs(second!)).toEqual(['sharp']);
  });
  it('keeps a pickup as a short first bar', () => {
    const xml = freshTuneXml({ ...tune([[4, 0, 2], [0, 0, 8], [2, 0, 8]]), pickup: 2 }, 'C', 'x');
    const bars = measures(xml);
    expect(bars).toHaveLength(3);
    expect(Array.from(bars[0]!.matchAll(/<duration>(\d+)<\/duration>/g), (m) => Number(m[1]))).toEqual([2]);
    expect(bars[1]).toContain('<type>whole</type>');
  });
});

describe('bundled fresh-tunes.json', () => {
  it('renders every tune in every key of its mode, bars full, never below MIDI 57', () => {
    const tunes = JSON.parse(readFileSync(join(__dirname, '../src/renderer/assets/fresh-tunes.json'), 'utf-8')) as FreshTune[];
    expect(tunes.length).toBeGreaterThan(400);
    for (const t of tunes) {
      for (const k of FRESH_KEYS.filter((x) => x.mode === t.mode)) {
        const xml = freshTuneXml(t, k.name, t.id);
        const bars = measures(xml);
        expect(bars.length).toBe(t.pickup ? 9 : 8);
        for (const p of pitches(xml)) {
          const midi = 12 * (p.octave + 1) + { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[p.step]! + p.alter;
          expect(midi).toBeGreaterThanOrEqual(57);
        }
      }
    }
  });
});
