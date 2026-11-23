import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  MAX_TRIES,
  UnsavedQueue,
  readUnsaved,
  checkPieceStem,
  isPieceStem,
  resolveScoreFile,
  writeFileAtomic,
  writeUnsaved,
  type UnsavedEdit,
} from '../src/main/scoreFiles';

let root: string;
let dir: string;
let outside: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), 'scorefiles-'));
  dir = path.join(root, 'pieces');
  outside = path.join(root, 'outside');
  await fs.mkdir(dir);
  await fs.mkdir(outside);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const XML = '<score-partwise/>';

async function makePiece(stem: string, where = dir): Promise<string> {
  const file = path.join(where, `${stem}.musicxml`);
  await fs.writeFile(file, XML, 'utf8');
  return file;
}

describe('resolveScoreFile: accepted names', () => {
  it.each(['sorcerers-apprentice', "The Sorcerer's Apprentice", 'Op. 28 No. 7'])(
    'accepts %j and returns the realpath',
    async (stem) => {
      const file = await makePiece(stem);
      const expected = await fs.realpath(file);
      await expect(resolveScoreFile(dir, stem)).resolves.toBe(expected);
    },
  );
});

describe('resolveScoreFile: rejected names', () => {
  const bad: Array<[string, unknown]> = [
    ['empty', ''],
    ['parent traversal', '../x'],
    ['forward slash', 'a/b'],
    ['backslash', 'a\\b'],
    ['dot file', '.hidden'],
    ['padded', ' padded'],
    ['NUL character', 'x\u0000y'],
    ['backup', 'sorcerers-apprentice.pre-b3-4-fix'],
    ['non-string', 42],
    ['too long', 'a'.repeat(201)],
  ];

  it.each(bad)('rejects %s', async (_label, stem) => {
    await expect(resolveScoreFile(dir, stem)).rejects.toThrow('bad piece name');
  });

  it('rejects a backup even when the file exists', async () => {
    await makePiece('sorcerers-apprentice.pre-b3-4-fix');
    await expect(resolveScoreFile(dir, 'sorcerers-apprentice.pre-b3-4-fix')).rejects.toThrow('bad piece name');
  });
});

describe('resolveScoreFile: missing file', () => {
  it("rejects with 'no such piece'", async () => {
    await expect(resolveScoreFile(dir, 'nope')).rejects.toThrow('no such piece');
  });
});

describe('resolveScoreFile: links', () => {
  it('rejects a file symlink that escapes the folder', async (ctx) => {
    const target = path.join(outside, 'target.musicxml');
    await fs.writeFile(target, XML, 'utf8');
    try {
      await fs.symlink(target, path.join(dir, 'evil.musicxml'), 'file');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EPERM') {
        ctx.skip();
        return;
      }
      throw err;
    }
    await expect(resolveScoreFile(dir, 'evil')).rejects.toThrow('bad piece name');
  });

  it('rejects a junction named like a piece that points to a directory', async () => {
    await fs.symlink(outside, path.join(dir, 'jx.musicxml'), 'junction');
    await expect(resolveScoreFile(dir, 'jx')).rejects.toThrow('bad piece name');
  });

  it('still resolves a file when the pieces dir itself is reached through a link', async () => {
    const file = await makePiece('real-piece');
    const dirLink = path.join(root, 'dirLink');
    await fs.symlink(dir, dirLink, 'junction');
    const expected = await fs.realpath(file);
    await expect(resolveScoreFile(dirLink, 'real-piece')).resolves.toBe(expected);
  });
});

describe('resolveScoreFile: case folding', () => {
  const folds = process.platform === 'win32' || process.platform === 'darwin';

  it('resolves a differently-cased dir when foldCase is true', async (ctx) => {
    if (!folds) {
      ctx.skip();
      return;
    }
    const file = await makePiece('Case Piece');
    const expected = await fs.realpath(file);
    const flipped = dir.toUpperCase();
    const got = await resolveScoreFile(flipped, 'Case Piece', true);
    expect(got.toLowerCase()).toBe(expected.toLowerCase());
  });

  it('uses an exact compare when foldCase is false (canonical dir passes)', async () => {
    const file = await makePiece('exact');
    const canonicalDir = await fs.realpath(dir);
    const expected = await fs.realpath(file);
    await expect(resolveScoreFile(canonicalDir, 'exact', false)).resolves.toBe(expected);
  });
});

describe('writeFileAtomic', () => {
  it('writes content and leaves no temp files', async () => {
    const file = path.join(dir, 'out.musicxml');
    await writeFileAtomic(file, 'hello');
    expect(await fs.readFile(file, 'utf8')).toBe('hello');
    const names = await fs.readdir(dir);
    expect(names).toEqual(['out.musicxml']);
    expect(names.some((n) => n.endsWith('.tmp'))).toBe(false);
  });

  it('overwrites an existing file', async () => {
    const file = path.join(dir, 'out.musicxml');
    await fs.writeFile(file, 'old', 'utf8');
    await writeFileAtomic(file, 'new');
    expect(await fs.readFile(file, 'utf8')).toBe('new');
    const names = await fs.readdir(dir);
    expect(names.filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });
});

describe('readUnsaved / writeUnsaved', () => {
  const good: UnsavedEdit[] = [
    { stem: 'a', measure: 1, staff: 1, onset: 0, midi: 60, digit: '3', name: 'C4', at: 1000 },
    { stem: 'b', measure: 2, staff: 2, onset: 1.5, midi: 41, digit: null, at: 2000 },
  ];

  it('round-trips valid entries', async () => {
    const file = path.join(root, 'unsaved.json');
    await writeUnsaved(file, good);
    expect(await readUnsaved(file)).toEqual(good);
  });

  it('filters invalid entries', async () => {
    const file = path.join(root, 'unsaved.json');
    const mixed = [
      good[0],
      { ...good[1], digit: '7' },
      { measure: 1, staff: 1, onset: 0, midi: 60, digit: '1', at: 1 },
      { ...good[0], measure: Number.NaN },
      good[1],
    ];
    await writeUnsaved(file, mixed);
    expect(await readUnsaved(file)).toEqual(good);
  });

  it('deletes the file when writing an empty list', async () => {
    const file = path.join(root, 'unsaved.json');
    await writeUnsaved(file, good);
    await writeUnsaved(file, []);
    await expect(fs.access(file)).rejects.toThrow();
    expect(await readUnsaved(file)).toEqual([]);
  });

  it('deletes the file when every entry is invalid', async () => {
    const file = path.join(root, 'unsaved.json');
    await writeUnsaved(file, good);
    await writeUnsaved(file, [{ stem: 'x', measure: 1, staff: 1, onset: 0, midi: 60, digit: '9', at: 1 }]);
    await expect(fs.access(file)).rejects.toThrow();
  });

  it('reads a missing file as empty', async () => {
    expect(await readUnsaved(path.join(root, 'missing.json'))).toEqual([]);
  });

  it('reads corrupt JSON as [] and renames it aside', async () => {
    const file = path.join(root, 'unsaved.json');
    await fs.writeFile(file, '{not json', 'utf8');
    expect(await readUnsaved(file)).toEqual([]);
    await expect(fs.access(file)).rejects.toThrow();
    const names = await fs.readdir(root);
    expect(names.some((n) => n.startsWith('unsaved.json.bad-'))).toBe(true);
  });
});

describe('resolveScoreFile: a link to a backup (#6654 review)', () => {
  it('rejects a piece-named link whose target is a .pre-* backup in the same folder', async (ctx) => {
    await makePiece('foo.pre-annotate');
    try {
      await fs.symlink(path.join(dir, 'foo.pre-annotate.musicxml'), path.join(dir, 'foo.musicxml'), 'file');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EPERM') {
        ctx.skip();
        return;
      }
      throw err;
    }
    await expect(resolveScoreFile(dir, 'foo')).rejects.toThrow('bad piece name');
  });
});

describe('UnsavedQueue', () => {
  const edit = (midi: number, digit = '3') => ({ measure: 1, staff: 1, onset: 0, midi, digit });
  let q: UnsavedQueue;
  let file: string;
  beforeEach(async () => {
    file = path.join(root, 'unsaved-edits.json');
    q = new UnsavedQueue(file, () => dir);
    await makePiece('p');
  });

  it('keeps every edit when adds overlap', async () => {
    const counts = await Promise.all([60, 62, 64, 65, 67].map((m) => q.add('p', [edit(m)])));
    expect(Math.max(...counts)).toBe(5);
    expect((await q.for('p')).edits.map((e) => e.midi).sort()).toEqual([60, 62, 64, 65, 67]);
  });

  it('clear(upTo) keeps edits queued after the save started', async () => {
    await q.add('p', [edit(60)]);
    const started = Date.now();
    await new Promise((r) => setTimeout(r, 5));
    await q.add('p', [edit(62)]);
    expect(await q.clear('p', started)).toBe(1);
    expect((await q.for('p')).edits.map((e) => e.midi)).toEqual([62]);
    expect(await q.clear('p', null)).toBe(0);
  });

  it('marks edits stale when the file changed after they were queued', async () => {
    await q.add('p', [edit(60)]);
    const later = new Date(Date.now() + 60_000);
    await fs.utimes(path.join(dir, 'p.musicxml'), later, later);
    const got = await q.for('p');
    expect(got.edits).toEqual([]);
    expect(got.stale).toHaveLength(1);
  });

  it('drops an edit after MAX_TRIES failed retries', async () => {
    await q.add('p', [edit(60)]);
    for (let i = 1; i < MAX_TRIES; i++) expect((await q.failed('p')).left).toBe(1);
    const last = await q.failed('p');
    expect(last.left).toBe(0);
    expect(last.dropped).toHaveLength(1);
    expect(await readUnsaved(file)).toEqual([]);
  });

  it('leaves other pieces alone', async () => {
    await makePiece('other');
    await q.add('p', [edit(60)]);
    await q.add('other', [edit(62)]);
    await q.clear('p', null);
    expect((await q.for('other')).edits).toHaveLength(1);
  });
});

describe('isPieceStem / checkPieceStem: one rule for every path (#6654, asg 14109)', () => {
  it('takes library slugs and title-named pieces', () => {
    for (const stem of ['sorcerers-apprentice', "The Sorcerer's Apprentice", 'Kum Ba Yah', 'Spin the Wheel (intermediate)']) {
      expect(isPieceStem(stem)).toBe(true);
      expect(checkPieceStem(stem)).toBe(stem);
    }
  });
  it('refuses backups, paths, dot files and junk', () => {
    for (const stem of ['sorcerers-apprentice.pre-b3-4-fix', '../x', 'a/b', 'a\\b', '.hidden', ' padded', '', 'x'.repeat(201), 'ab:c', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b', 'a\u0001b', 7, null]) {
      expect(isPieceStem(stem)).toBe(false);
      expect(() => checkPieceStem(stem)).toThrow('bad piece name');
    }
  });
});
