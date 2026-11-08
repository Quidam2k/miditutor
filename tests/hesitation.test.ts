import { describe, it, expect } from 'vitest';
import { ALL, MIN_SLICE_HITS, parseSlices, recordSlices, sliceKeys, slowestSlices, Slices } from '../src/renderer/engine/Hesitation';
import { midiNumberToPitch } from '../src/renderer/engine/MusicTheory';

const D = { name: 'D', fifths: 2 };
const Bb = { name: 'Bb', fifths: -2 };

describe('hesitation slices', () => {
  it('sorts a note into clef, position, accidental and key', () => {
    expect(sliceKeys(midiNumberToPitch(67), 'treble', null)).toEqual(['clef:treble', 'pos:staff', 'acc:none', 'key:none']);
    // Middle C in treble: the first ledger line below. D4 just under the staff is still "on the staff".
    expect(sliceKeys(midiNumberToPitch(60), 'treble', null)[1]).toBe('pos:below');
    expect(sliceKeys(midiNumberToPitch(62), 'treble', null)[1]).toBe('pos:staff');
    expect(sliceKeys(midiNumberToPitch(81), 'treble', null)[1]).toBe('pos:above');
    expect(sliceKeys(midiNumberToPitch(60), 'bass', null)[1]).toBe('pos:above');
    expect(sliceKeys(midiNumberToPitch(40), 'bass', null)[1]).toBe('pos:below');
    // F# in D major prints bare; F natural there needs a natural sign; Eb in Bb prints bare.
    expect(sliceKeys(midiNumberToPitch(66), 'treble', D).slice(2)).toEqual(['acc:none', 'key:sharp']);
    expect(sliceKeys(midiNumberToPitch(65), 'treble', D)[2]).toBe('acc:natural');
    expect(sliceKeys(midiNumberToPitch(63, true), 'treble', Bb).slice(2)).toEqual(['acc:none', 'key:flat']);
    expect(sliceKeys(midiNumberToPitch(61), 'treble', null)[2]).toBe('acc:sharp');
    expect(sliceKeys(midiNumberToPitch(61, true), 'treble', { name: 'C', fifths: 0 }).slice(2)).toEqual(['acc:flat', 'key:none']);
  });

  it('counts only timed right answers, capped', () => {
    const keys = ['clef:bass'];
    let s: Slices = {};
    expect(recordSlices(s, keys, false, 900)).toBe(s);
    expect(recordSlices(s, keys, true, null)).toBe(s);
    s = recordSlices(s, keys, true, 1000);
    s = recordSlices(s, keys, true, 3000);
    expect(s['clef:bass']).toEqual({ n: 2, avgMs: 2000 });
    expect(s[ALL]).toEqual({ n: 2, avgMs: 2000 });
    expect(recordSlices({}, keys, true, 60_000)[ALL].avgMs).toBe(10_000);
  });

  it('names the three slowest slices with enough answers, slower than his usual', () => {
    let s: Slices = {};
    for (let i = 0; i < MIN_SLICE_HITS; i++) {
      s = recordSlices(s, ['clef:treble', 'pos:staff', 'acc:none', 'key:none'], true, 1000);
      s = recordSlices(s, ['clef:bass', 'pos:below', 'acc:flat', 'key:flat'], true, 3000);
    }
    s = recordSlices(s, ['clef:bass', 'pos:above', 'acc:natural', 'key:sharp'], true, 9000); // one slow note: not a pattern
    const spots = slowestSlices(s);
    // The 9 s note can't make its own slices show, but it does count toward bass clef.
    expect(spots.map((x) => x.key)).toEqual(['clef:bass', 'acc:flat', 'key:flat']);
    expect(spots.some((x) => x.key === 'pos:above' || x.key === 'key:sharp')).toBe(false);
    expect(spots[1].label).toBe('a flat beside it');
    expect(spots[1].overMs).toBeCloseTo(3000 - s[ALL].avgMs);
    expect(slowestSlices({})).toEqual([]);
  });

  it('keeps only known, well-formed stored slices', () => {
    const raw = JSON.parse('{"all":{"n":3,"avgMs":1200},"clef:bass":{"n":2,"avgMs":1500},"bogus":{"n":2,"avgMs":1},"key:flat":{"n":0,"avgMs":1},"pos:below":{"n":2,"avgMs":-1},"acc:sharp":null}');
    expect(parseSlices(raw)).toEqual({ all: { n: 3, avgMs: 1200 }, 'clef:bass': { n: 2, avgMs: 1500 } });
    expect(parseSlices([])).toEqual({});
  });
});
