import { describe, it, expect } from 'vitest';
import {
  keyPitchClass,
  scaleOffsets,
  arpeggioOffsets,
  backwardsHint,
  noteNames,
  startSequence,
  expectedNext,
  playNote,
  triadsFromGroups,
  triadDisplayName,
  matchesTriad,
  orderUnpracticed,
  writtenFingering,
  type HomeworkItem,
  type SequenceState,
} from '../src/renderer/engine/Homework';

describe('scales', () => {
  it('computes key pitch classes', () => {
    expect(keyPitchClass('C')).toBe(0);
    expect(keyPitchClass('F#')).toBe(6);
    expect(keyPitchClass('Bb')).toBe(10);
    expect(keyPitchClass('Cb')).toBe(11);
  });

  it('one octave of major goes up and down in 15 notes', () => {
    expect(scaleOffsets('major', 1)).toEqual([0, 2, 4, 5, 7, 9, 11, 12, 11, 9, 7, 5, 4, 2, 0]);
  });

  it('scales default to two octaves: 29 notes, top tonic once', () => {
    const offsets = scaleOffsets('major');
    expect(offsets).toHaveLength(29);
    expect(offsets[14]).toBe(24);
    expect(offsets.slice(0, 15)).toEqual([0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23, 24]);
    expect(offsets[28]).toBe(0);
  });

  it('harmonic minor keeps its raised seventh both ways', () => {
    expect(scaleOffsets('harmonic', 1)).toEqual([0, 2, 3, 5, 7, 8, 11, 12, 11, 8, 7, 5, 3, 2, 0]);
  });

  it('melodic minor descends as natural minor', () => {
    expect(scaleOffsets('melodic', 1)).toEqual([0, 2, 3, 5, 7, 9, 11, 12, 10, 8, 7, 5, 3, 2, 0]);
    expect(scaleOffsets('melodic').slice(14)).toEqual([24, 22, 20, 19, 17, 15, 14, 12, 10, 8, 7, 5, 3, 2, 0]);
  });

  it('finds JP\'s written fingering under the keys homework_sync writes', () => {
    const item = { id: 'x', kind: 'arpeggio', label: 'x', source: 'x', fingering: { 'RH arp': '123 123 5' } } as HomeworkItem;
    expect(writtenFingering(item, 'RH')).toBe('123 123 5');
    expect(writtenFingering(item, 'LH')).toBeNull();
    expect(writtenFingering({ ...item, fingering: undefined }, 'RH')).toBeNull();
  });

  it('arpeggios', () => {
    expect(arpeggioOffsets('major')).toEqual([0, 4, 7, 12, 7, 4, 0]);
    expect(arpeggioOffsets('minor')).toEqual([0, 3, 7, 12, 7, 3, 0]);
  });

  it('spells E harmonic minor with letter stepping', () => {
    expect(noteNames('E', scaleOffsets('harmonic')).slice(0, 8)).toEqual(['E', 'F#', 'G', 'A', 'B', 'C', 'D#', 'E']);
  });

  it('spells flat keys and arpeggios', () => {
    expect(noteNames('Bb', scaleOffsets('major')).slice(0, 8)).toEqual(['Bb', 'C', 'D', 'Eb', 'F', 'G', 'A', 'Bb']);
    expect(noteNames('E', arpeggioOffsets('minor'))).toEqual(['E', 'G', 'B', 'E', 'B', 'G', 'E']);
  });
});

describe('sequence follower', () => {
  const E = keyPitchClass('E');
  const offsets = scaleOffsets('harmonic');

  function run(s: SequenceState, notes: number[]): SequenceState {
    return notes.reduce((st, n) => playNote(st, n, E).state, s);
  }

  it.each([40, 76])('starts on any E (%i)', (start) => {
    const s = startSequence(offsets);
    expect(expectedNext(s, E)).toContain(start);
    const r = playNote(s, start, E);
    expect(r.ok).toBe(true);
    expect(expectedNext(r.state, E)).toEqual([start + 2]);
  });

  it('a wrong note keeps progress and counts a mistake', () => {
    const s = run(startSequence(offsets), [40, 42]);
    const r = playNote(s, 50, E);
    expect(r.ok).toBe(false);
    expect(r.state.index).toBe(2);
    expect(r.state.mistakes).toBe(1);
    expect(expectedNext(r.state, E)).toEqual([43]);
  });

  it('a non-tonic first note is a mistake with no base', () => {
    const r = playNote(startSequence(offsets), 41, E);
    expect(r.ok).toBe(false);
    expect(r.state.base).toBeNull();
    expect(r.state.mistakes).toBe(1);
  });

  it('a tonic too high for two octaves is not a start', () => {
    const s = startSequence(offsets);
    expect(expectedNext(s, E)).not.toContain(100); // E7 + 24 is off the keyboard
    expect(expectedNext(s, E)).toContain(76);
    expect(playNote(s, 100, E).ok).toBe(false);
  });

  it('finishes after 29 notes', () => {
    let state = startSequence(offsets);
    let last = { ok: false, done: false };
    for (const o of offsets) {
      const r = playNote(state, 40 + o, E);
      state = r.state;
      last = r;
    }
    expect(last.ok).toBe(true);
    expect(last.done).toBe(true);
    expect(state.index).toBe(29);
    expect(expectedNext(state, E)).toEqual([]);
  });
});

describe('triads', () => {
  const targets = triadsFromGroups({
    WWW: ['C', 'Dm'],
    BBB: ['F#/Gb', 'D#m/Ebm'],
    Bbm: 'BBW',
  });

  it('builds one target per chord', () => {
    expect(targets.map((t) => t.name)).toEqual(['C', 'Dm', 'F#', 'D#m', 'Bbm']);
    expect(targets.map((t) => t.colour)).toEqual(['WWW', 'WWW', 'BBB', 'BBB', 'BBW']);
  });

  it('computes pitch classes and merged display names', () => {
    const by = Object.fromEntries(targets.map((t) => [t.name, t]));
    expect(by['C'].pcs).toEqual([0, 4, 7]);
    expect(by['Dm'].pcs).toEqual([2, 5, 9]);
    expect(by['F#'].pcs).toEqual([1, 6, 10]);
    expect(by['F#'].display).toBe('F# / Gb');
    expect(by['D#m'].pcs).toEqual([3, 6, 10]);
    expect(by['D#m'].display).toBe('D#m / Ebm');
    expect(by['Bbm'].pcs).toEqual([1, 5, 10]);
  });

  it('dedupes by name', () => {
    expect(triadsFromGroups({ WWW: ['C'], BBB: ['C'] })).toHaveLength(1);
  });

  it('speaks chord names', () => {
    expect(triadDisplayName('Ebm')).toBe('E flat minor');
    expect(triadDisplayName('F#')).toBe('F sharp major');
    expect(triadDisplayName('C')).toBe('C major');
  });

  it('matchesTriad accepts any inversion but only the exact chord', () => {
    expect(matchesTriad([64, 67, 72], [0, 4, 7])).toBe(true);
    expect(matchesTriad([48, 64, 67, 72], [0, 4, 7])).toBe(true);
    expect(matchesTriad([60, 64], [0, 4, 7])).toBe(false);
    expect(matchesTriad([60, 64, 67, 70], [0, 4, 7])).toBe(false);
  });
});

describe('orderUnpracticed', () => {
  it('puts unpracticed first, then oldest practiced', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    const out = orderUnpracticed(items, { a: '2026-10-20', c: '2026-10-01' }, () => 0);
    expect(out.slice(2).map((i) => i.id)).toEqual(['c', 'a']);
    expect(out.slice(0, 2).map((i) => i.id).sort()).toEqual(['b', 'd']);
  });

  it('does not mutate the input', () => {
    const items = [{ id: 'a' }, { id: 'b' }];
    orderUnpracticed(items, {});
    expect(items.map((i) => i.id)).toEqual(['a', 'b']);
  });
});

describe('backwardsHint (#10133)', () => {
  const piece = (notes: string[]) => ({ id: 'piece:x', kind: 'piece' as const, label: 'Sorcerer', source: '', notes });
  it('a piece whose notes say backwards gets the Score tab how-to', () => {
    expect(backwardsHint(piece(['bars 22-35, practise backwards']))).toBe(
      'Score tab: Loop bars on your section, then Build backwards',
    );
  });
  it('nothing for other pieces or other kinds', () => {
    expect(backwardsHint(piece(['hands separately']))).toBeNull();
    expect(backwardsHint({ id: 'task:b', kind: 'task', label: 'play it backwards', source: '' })).toBeNull();
  });
});
