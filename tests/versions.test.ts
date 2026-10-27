import { describe, expect, it } from 'vitest';
import { groupOf, parseVersions } from '../src/shared/versions';

const O = {
  title: 'O',
  versions: [
    { file: 'o-from-o.musicxml', label: 'Easy' },
    { file: 'o-musicnotes-arrangement.musicxml', label: 'Harder', mixable: false },
  ],
};

describe('parseVersions', () => {
  it('keeps valid groups', () => {
    expect(parseVersions({ o: O })).toEqual({ o: O });
  });

  it('drops malformed groups and versions', () => {
    const map = parseVersions({
      bad: 'x',
      untitled: { versions: O.versions },
      lonely: { title: 'L', versions: [{ file: 'a.musicxml', label: 'Easy' }, { file: 'a.musicxml', label: 'Again' }] },
      mixed: { title: 'M', versions: [{ file: 'm.musicxml', label: 'Easy', mixable: 'no' }, { file: 2 }, { file: 'n.musicxml', label: 'Harder' }] },
    });
    expect(Object.keys(map)).toEqual(['mixed']);
    expect(map.mixed.versions).toEqual([
      { file: 'm.musicxml', label: 'Easy' },
      { file: 'n.musicxml', label: 'Harder' },
    ]);
  });

  it('keeps valid align entries for files in the group and drops the rest', () => {
    const good = { semis: -2, bars: [[1, 1], [2, 2]], sections: [{ easy: [1, 2], harder: [1, 2], cost: 0.2 }, { easy: [3, 4], harder: [3, 3] }] };
    const map = parseVersions({
      o: {
        ...O,
        align: {
          'o-musicnotes-arrangement.musicxml': good,
          'not-in-group.musicxml': good,
          'o-from-o.musicxml': { ...good, semis: 'x' },
        },
      },
    });
    expect(map.o.align).toEqual({ 'o-musicnotes-arrangement.musicxml': good });
  });

  it('drops align entries with a bad shape, and the align key when none survive', () => {
    const file = 'o-musicnotes-arrangement.musicxml';
    const good = { semis: 0, bars: [[1, 1]], sections: [{ easy: [1, 1], harder: [1, 1] }] };
    for (const bad of [
      null,
      { ...good, bars: [[1, 'a']] },
      { ...good, bars: [[1, 1, 1]] },
      { ...good, bars: 'x' },
      { ...good, sections: [{ easy: [1, 1] }] },
      { ...good, sections: [{ easy: [1, 1], harder: ['a', 2] }] },
      { ...good, sections: {} },
      { bars: good.bars, sections: good.sections },
    ]) {
      const map = parseVersions({ o: { ...O, align: { [file]: bad } } });
      expect(map.o.versions.length).toBe(2);
      expect(map.o).not.toHaveProperty('align');
    }
    expect(parseVersions({ o: { ...O, align: 'x' } }).o).not.toHaveProperty('align');
  });

  it('rejects non-objects', () => {
    expect(parseVersions(null)).toEqual({});
    expect(parseVersions([O])).toEqual({});
  });
});

describe('groupOf', () => {
  it('finds a file and its place in the group', () => {
    expect(groupOf({ o: O }, 'o-musicnotes-arrangement.musicxml')).toEqual({ slug: 'o', title: 'O', label: 'Harder', index: 1 });
    expect(groupOf({ o: O }, 'quidam.musicxml')).toBeUndefined();
  });
});
