import { describe, expect, it } from 'vitest';
import { mixRanges, mixTrust, type MixChoice, type MixSection } from '../src/shared/mix';
import { groupOf, mixPlanOf, parseMixes, withMixes, type SavedMix, type VersionGroup } from '../src/shared/versions';

const sections: MixSection[] = [
  { easy: [1, 8], harder: [1, 8] },
  { easy: [9, 16], harder: [9, 16] },
];
const HARDER = 'o-harder.musicxml';
const group = (extra: Partial<VersionGroup> = {}): VersionGroup => ({
  title: 'O',
  versions: [
    { file: 'o-easy.musicxml', label: 'Easy' },
    { file: HARDER, label: 'Harder' },
  ],
  align: { [HARDER]: { semis: -2, bars: [[1, 1]], sections } },
  ...extra,
});
const saved = (extra: Partial<SavedMix> = {}): SavedMix => ({
  file: 'o-my-mix.musicxml',
  harder: HARDER,
  choice: ['easy', 'harder'],
  trust: { status: 'unverified', note: 'Harder bars 9-16 not yet checked' },
  ...extra,
});

describe('parseMixes', () => {
  const entry = { file: 'o-my-mix.musicxml', harder: HARDER, choice: ['easy', 'harder'], trust: { status: 'checked', note: '' } };

  it('keeps a valid entry', () => {
    expect(parseMixes({ o: entry })).toEqual({ o: { ...entry, trust: { status: 'checked', note: '' } } });
  });

  it('rejects a verified trust: a mix is a new file nobody reviewed', () => {
    const verified = { status: 'verified', note: '', score_sha256: 'abc' };
    expect(parseMixes({ o: { ...entry, trust: verified } })).toEqual({});
  });

  it('rejects bad choice values and missing fields', () => {
    expect(parseMixes({ o: { ...entry, choice: ['easy', 'both'] } })).toEqual({});
    expect(parseMixes({ o: { ...entry, choice: 'easy' } })).toEqual({});
    expect(parseMixes({ o: { ...entry, file: undefined } })).toEqual({});
    expect(parseMixes({ o: { ...entry, harder: 3 } })).toEqual({});
    expect(parseMixes({ o: { ...entry, trust: undefined } })).toEqual({});
    expect(parseMixes({ o: { ...entry, trust: { status: 'bogus' } } })).toEqual({});
    expect(parseMixes(null)).toEqual({});
    expect(parseMixes([entry])).toEqual({});
  });
});

describe('withMixes', () => {
  it('adds a My mix version that is not itself mixable, and records the saved mix', () => {
    const out = withMixes({ o: group() }, { o: saved() });
    expect(out.o.versions.at(-1)).toEqual({ file: 'o-my-mix.musicxml', label: 'My mix', mixable: false });
    expect(out.o.saved).toEqual(saved());
  });

  it('ignores an unknown slug or a harder file outside the group', () => {
    expect(withMixes({ o: group() }, { nope: saved() })).toEqual({ o: group() });
    expect(withMixes({ o: group() }, { o: saved({ harder: 'other.musicxml' }) })).toEqual({ o: group() });
  });

  it('does not duplicate a mix already listed', () => {
    const once = withMixes({ o: group() }, { o: saved() });
    const twice = withMixes(once, { o: saved() });
    expect(twice.o.versions.filter((v) => v.label === 'My mix')).toHaveLength(1);
  });

  it('does not mutate its input', () => {
    const map = { o: group() };
    withMixes(map, { o: saved() });
    expect(map.o.versions).toHaveLength(2);
  });
});

describe('mixPlanOf', () => {
  it('needs an Easy version and an aligned Harder one, and carries the semitones', () => {
    expect(mixPlanOf(group())).toEqual({ easy: 'o-easy.musicxml', harder: HARDER, semis: -2, sections });
    expect(mixPlanOf(group({ align: undefined }))).toBeUndefined();
    expect(mixPlanOf(group({ versions: [{ file: HARDER, label: 'Harder' }, { file: 'x.musicxml', label: 'Other' }] }))).toBeUndefined();
  });

  it('skips a Harder version marked not mixable', () => {
    const g = group({ versions: [{ file: 'o-easy.musicxml', label: 'Easy' }, { file: HARDER, label: 'Harder', mixable: false }] });
    expect(mixPlanOf(g)).toBeUndefined();
  });

  it('carries the saved choice only when the harder file and length fit', () => {
    expect(mixPlanOf(group({ saved: saved() }))?.choice).toEqual(['easy', 'harder']);
    expect(mixPlanOf(group({ saved: saved({ harder: 'other.musicxml' }) }))).not.toHaveProperty('choice');
    expect(mixPlanOf(group({ saved: saved({ choice: ['easy'] }) }))).not.toHaveProperty('choice');
  });
});

describe('groupOf with a mix', () => {
  it('includes the plan on every version of the song, My mix included', () => {
    const map = withMixes({ o: group() }, { o: saved() });
    const plan = mixPlanOf(map.o);
    expect(groupOf(map, 'o-easy.musicxml')?.mix).toEqual(plan);
    expect(groupOf(map, 'o-my-mix.musicxml')).toMatchObject({ slug: 'o', label: 'My mix', index: 2, mix: plan });
    expect(plan?.choice).toEqual(['easy', 'harder']);
  });

  it('has no mix when the song cannot be mixed', () => {
    expect(groupOf({ o: group({ align: undefined }) }, 'o-easy.musicxml')).not.toHaveProperty('mix');
  });
});

describe('mixRanges', () => {
  const three: MixSection[] = [
    { easy: [1, 4], harder: [1, 4] },
    { easy: [5, 8], harder: [5, 10] },
    { easy: [9, 12], harder: [11, 14] },
  ];

  it('numbers ranges as the renumbered mix, with uneven section lengths', () => {
    expect(mixRanges(three, ['easy', 'harder', 'easy'])).toEqual({ easy: [[1, 4], [11, 14]], harder: [[5, 10]] });
  });

  it('merges adjacent runs from the same source', () => {
    expect(mixRanges(three, ['easy', 'harder', 'harder'])).toEqual({ easy: [[1, 4]], harder: [[5, 14]] });
    expect(mixRanges(three, ['easy', 'easy', 'easy'])).toEqual({ easy: [[1, 12]], harder: [] });
  });

  it('keeps separate runs apart', () => {
    expect(mixRanges(three, ['harder', 'easy', 'harder'])).toEqual({ easy: [[5, 8]], harder: [[1, 4], [9, 12]] });
  });
});

describe('mixTrust', () => {
  const checked = { status: 'checked' as const, note: '' };
  const unverified = { status: 'unverified' as const, note: '' };
  const pick = (...c: MixChoice[]) => c;

  it('is checked with no note when every used source is checked', () => {
    expect(mixTrust(checked, checked, sections, pick('easy', 'harder'))).toEqual({ status: 'checked', note: '' });
  });

  it('counts a verified source as checked and never returns verified', () => {
    const verified = { status: 'verified' as const, note: 'mine', sha: 'abc' };
    expect(mixTrust(verified, verified, sections, pick('easy', 'harder'))).toEqual({ status: 'checked', note: '' });
  });

  it('names the unchecked harder bars by mix bar number', () => {
    expect(mixTrust(checked, unverified, sections, pick('easy', 'harder'))).toEqual({
      status: 'unverified',
      note: 'Harder bars 9-16 not yet checked',
    });
  });

  it('treats a missing trust entry as unverified', () => {
    expect(mixTrust(undefined, checked, sections, pick('easy', 'easy'))).toEqual({
      status: 'unverified',
      note: 'Easy bars 1-16 not yet checked',
    });
  });

  it('lets issues win over unverified and includes the source note', () => {
    const issues = { status: 'issues' as const, note: 'wrong clef' };
    expect(mixTrust(issues, unverified, sections, pick('easy', 'harder'))).toEqual({
      status: 'issues',
      note: 'Easy bars 1-8 have known issues (wrong clef); Harder bars 9-16 not yet checked',
    });
  });

  it('ignores a source that is not used', () => {
    expect(mixTrust(checked, unverified, sections, pick('easy', 'easy'))).toEqual({ status: 'checked', note: '' });
  });
});
