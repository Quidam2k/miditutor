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
