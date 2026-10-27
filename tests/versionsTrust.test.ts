import { describe, expect, it } from 'vitest';
import { applyTrust, groupOf, mixPlanOf, parseVersions, withMixes } from '../src/shared/versions';
import { parseTrust } from '../src/shared/trust';

function versionMap() {
  return parseVersions({
    song: {
      title: 'A song',
      versions: [
        { file: 'easy.xml', label: 'Easy' },
        { file: 'harder.xml', label: 'Harder' },
        { file: 'alternate.xml', label: 'Alternate' },
      ],
      align: {
        'harder.xml': {
          semis: 2,
          bars: [[1, 1]],
          sections: [{ easy: [1, 4], harder: [1, 4] }],
        },
        'alternate.xml': {
          semis: -2,
          bars: [[1, 2]],
          sections: [{ easy: [1, 4], harder: [2, 5] }],
        },
      },
    },
  });
}

function savedVersionMap() {
  return withMixes(versionMap(), {
    song: {
      file: 'my-mix.xml',
      harder: 'harder.xml',
      choice: ['easy'],
      trust: parseTrust({
        'my-mix.xml': { status: 'issues' },
      })['my-mix.xml'],
    },
  });
}

describe('applyTrust', () => {
  it('hides a flagged version and reports its file', () => {
    const trust = parseTrust({
      'alternate.xml': { status: 'issues', hide: true },
    });

    const { versions, hidden } = applyTrust(versionMap(), trust);

    expect(versions.song.versions.map((v) => v.file)).toEqual(['easy.xml', 'harder.xml']);
    expect(hidden).toEqual(new Set(['alternate.xml']));
    expect(groupOf(versions, 'alternate.xml')).toBeUndefined();
  });

  it('drops a group with only one version left without hiding the remaining file', () => {
    const trust = parseTrust({
      'harder.xml': { status: 'issues', hide: true },
      'alternate.xml': { status: 'issues', hide: true },
    });

    const { versions, hidden } = applyTrust(versionMap(), trust);

    expect(versions).toEqual({});
    expect(hidden).toEqual(new Set(['harder.xml', 'alternate.xml']));
    expect(hidden.has('easy.xml')).toBe(false);
  });

  it('never hides Easy', () => {
    const trust = parseTrust({
      'easy.xml': { status: 'issues', hide: true },
    });
    const map = versionMap();

    const { versions, hidden } = applyTrust(map, trust);

    expect(versions).toEqual(map);
    expect(hidden.size).toBe(0);
  });

  it('never hides My mix versions', () => {
    const map = versionMap();
    map.song.versions.push({ file: 'my-mix.xml', label: 'My mix', mixable: false });
    const trust = parseTrust({
      'my-mix.xml': { status: 'issues', hide: true },
    });

    const { versions, hidden } = applyTrust(map, trust);

    expect(versions).toEqual(map);
    expect(hidden.size).toBe(0);
  });

  it('keeps the saved mix’s Harder file even when it is flagged', () => {
    const map = savedVersionMap();
    const trust = parseTrust({
      'harder.xml': { status: 'issues', hide: true },
      'alternate.xml': { status: 'issues', hide: true },
    });

    const { versions, hidden } = applyTrust(map, trust);

    expect(versions.song.versions.map((v) => v.file)).toEqual(['easy.xml', 'harder.xml', 'my-mix.xml']);
    expect(versions.song.saved).toEqual(map.song.saved);
    expect(mixPlanOf(versions.song)).toMatchObject({
      harder: 'harder.xml',
      choice: ['easy'],
    });
    expect(hidden).toEqual(new Set(['alternate.xml']));
  });

  it('blocks My mix and carries the reason through groupOf', () => {
    const reason = 'The alignment needs repair.';
    const trust = parseTrust({
      'harder.xml': { status: 'issues', no_mix: reason },
    });

    const { versions, hidden } = applyTrust(versionMap(), trust);

    expect(versions.song.mixBlocked).toBe(reason);
    expect(mixPlanOf(versions.song)).toBeUndefined();
    expect(hidden.size).toBe(0);
    for (const version of versions.song.versions) {
      const ref = groupOf(versions, version.file);
      expect(ref?.mixBlocked).toBe(reason);
      expect(ref?.mix).toBeUndefined();
    }
  });

  it('selects the Harder source after hiding versions', () => {
    const reason = 'The alternate has missing bars.';
    const trust = parseTrust({
      'harder.xml': { status: 'issues', hide: true, no_mix: 'This source is hidden.' },
      'alternate.xml': { status: 'issues', no_mix: reason },
    });

    const { versions, hidden } = applyTrust(versionMap(), trust);

    expect(versions.song.mixBlocked).toBe(reason);
    expect(mixPlanOf(versions.song)).toBeUndefined();
    expect(hidden).toEqual(new Set(['harder.xml']));
  });

  it('does not use a hidden source’s mix restriction', () => {
    const trust = parseTrust({
      'harder.xml': { status: 'issues', hide: true, no_mix: 'This source is hidden.' },
    });

    const { versions } = applyTrust(versionMap(), trust);

    expect(versions.song.mixBlocked).toBeUndefined();
    expect(mixPlanOf(versions.song)?.harder).toBe('alternate.xml');
  });

  it('ignores restrictions on sources the mix plan would not select', () => {
    const map = versionMap();
    map.song.versions.splice(
      1,
      0,
      { file: 'unaligned.xml', label: 'Unaligned' },
      { file: 'scan.xml', label: 'Scan', mixable: false },
    );
    map.song.align!['scan.xml'] = map.song.align!['harder.xml'];
    const trust = parseTrust({
      'easy.xml': { status: 'issues', no_mix: 'Easy restriction.' },
      'unaligned.xml': { status: 'issues', no_mix: 'No alignment.' },
      'scan.xml': { status: 'issues', no_mix: 'Unrepaired scan.' },
      'alternate.xml': { status: 'issues', no_mix: 'Later source.' },
    });

    const { versions } = applyTrust(map, trust);

    expect(versions.song.mixBlocked).toBeUndefined();
    expect(mixPlanOf(versions.song)?.harder).toBe('harder.xml');
  });

  it('does not block My mix for an empty reason', () => {
    const trust = parseTrust({
      'harder.xml': { status: 'issues', no_mix: '' },
    });

    const { versions } = applyTrust(versionMap(), trust);

    expect(versions.song.mixBlocked).toBeUndefined();
    expect(mixPlanOf(versions.song)?.harder).toBe('harder.xml');
  });

  it('leaves the map deeply equal when there are no flags', () => {
    const map = savedVersionMap();
    const trust = parseTrust({
      'easy.xml': { status: 'issues' },
      'harder.xml': { status: 'issues' },
    });

    const { versions, hidden } = applyTrust(map, trust);

    expect(versions).toEqual(map);
    expect(hidden.size).toBe(0);
  });

  it('does not mutate either input', () => {
    const map = savedVersionMap();
    const trust = parseTrust({
      'harder.xml': { status: 'issues', no_mix: 'Missing notes.' },
      'alternate.xml': { status: 'issues', hide: true },
    });
    const originalMap = structuredClone(map);
    const originalTrust = structuredClone(trust);

    const { versions, hidden } = applyTrust(map, trust);

    expect(versions.song.mixBlocked).toBe('Missing notes.');
    expect(hidden).toEqual(new Set(['alternate.xml']));
    expect(map).toEqual(originalMap);
    expect(trust).toEqual(originalTrust);
    expect(versions).not.toBe(map);
    expect(versions.song).not.toBe(map.song);
    expect(versions.song.versions).not.toBe(map.song.versions);
  });
});
