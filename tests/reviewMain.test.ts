import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { Review } from '../src/main/review';

const SCORE = '<?xml version="1.0"?><score-partwise><work><work-title>Tiny</work-title></work><part id="P1"/></score-partwise>\n';
const sha = createHash('sha256').update(SCORE).digest('hex');

let lib: string;
let review: Review;

const layout = (over: Record<string, unknown> = {}) => ({
  version: 1, slug: 'tiny', score: 'tiny.musicxml', score_sha256: sha, crop_scale: 0.5,
  xml: { measures: 4, breaks: [1, 3], staves_per_system: 2 }, scan: { bars: 4, systems: 2 }, match: 'exact',
  systems: [1, 2].map((i) => ({
    index: i, page: '01.png', y0: 0, y1: 10, spacing: 20, staves: [], x_left: 0, x_right: 10,
    barlines: [0, 5, 10], bars: 2, measures: [i * 2 - 1, i * 2], numbers: null,
    crop: `review-pages/tiny/s0${i}.jpg`,
  })),
  ...over,
});

const trust = async () => JSON.parse(await readFile(path.join(lib, 'trust.json'), 'utf8'));

beforeEach(async () => {
  lib = await mkdtemp(path.join(os.tmpdir(), 'review-'));
  await mkdir(path.join(lib, 'pages', 'tiny'), { recursive: true });
  await mkdir(path.join(lib, 'review'), { recursive: true });
  await mkdir(path.join(lib, 'review-pages', 'tiny'), { recursive: true });
  await writeFile(path.join(lib, 'tiny.musicxml'), SCORE);
  await writeFile(path.join(lib, 'review', 'tiny.layout.json'), JSON.stringify(layout()));
  await writeFile(path.join(lib, 'review-pages', 'tiny', 's01.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
  await writeFile(path.join(lib, 'trust.json'), JSON.stringify({
    'tiny.musicxml': { status: 'issues', note: 'timing off in bar 2', source: 'omr_audit' },
  }));
  review = new Review({ library: lib, python: 'unused', scripts: 'unused' });
});

afterEach(async () => {
  await rm(lib, { recursive: true, force: true });
});

describe('Review', () => {
  it('lists pieces with pages and their review progress', async () => {
    const [piece] = await review.list();
    expect(piece).toMatchObject({ slug: 'tiny', title: 'Tiny', match: 'exact', systems: 2, confirmed: 0, verified: false });
    expect(piece.trust).toMatchObject({ status: 'issues' });
  });

  it('confirming every line writes "Verified by you" and a new mark restores the audit badge', async () => {
    await review.append('tiny', { kind: 'confirm_system', system: 1 });
    expect((await trust())['tiny.musicxml'].status).toBe('issues');
    const done = await review.append('tiny', { kind: 'confirm_system', system: 2 });
    expect(done.state.verified).toBe(true);
    const entry = (await trust())['tiny.musicxml'];
    expect(entry).toMatchObject({
      status: 'verified', source: 'todd-review', systems: [1, 2], score_sha256: sha,
      previous: { status: 'issues', source: 'omr_audit' },
    });
    expect(entry.note).toMatch(/, all 2 lines$/);

    const marked = await review.append('tiny', { kind: 'mark', system: 2, measure: 3 });
    expect(marked.state.verified).toBe(false);
    expect((await trust())['tiny.musicxml']).toEqual({ status: 'issues', note: 'timing off in bar 2', source: 'omr_audit' });
  });

  it('stamps ids, origin and the score hash; the log is append-only JSON lines', async () => {
    await review.append('tiny', { kind: 'confirm_system', system: 1, id: 'forged', origin: 'pinocchio' });
    const lines = (await readFile(path.join(lib, 'review', 'tiny.events.jsonl'), 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(1);
    const e = JSON.parse(lines[0]);
    expect(e.id).not.toBe('forged');
    expect(e).toMatchObject({ kind: 'confirm_system', system: 1, origin: 'solace', sha });
  });

  it('refuses a confirm on a line the scan and score do not line up on, and accept from the UI', async () => {
    const partial = layout({ match: 'partial' });
    (partial.systems[1] as { measures: unknown }).measures = null;
    await writeFile(path.join(lib, 'review', 'tiny.layout.json'), JSON.stringify(partial));
    await expect(review.append('tiny', { kind: 'confirm_system', system: 2 })).rejects.toThrow(/don't line up/);
    await expect(review.append('tiny', { kind: 'accept', mark: 'x' })).rejects.toThrow(/not an event/);
    await expect(review.append('../etc', { kind: 'mark' })).rejects.toThrow(/bad piece name/);
  });

  it('serves crops only from the piece\'s own folder', async () => {
    expect(await review.crop('tiny', 'review-pages/tiny/s01.jpg')).toMatch(/^data:image\/jpeg;base64,/);
    await expect(review.crop('tiny', 'trust.json')).rejects.toThrow(/bad crop path/);
    await expect(review.crop('tiny', 'review-pages/other/s01.jpg')).rejects.toThrow(/bad crop path/);
  });

  it('a re-ingested score drops his badge', async () => {
    await review.append('tiny', { kind: 'confirm_system', system: 1 });
    await review.append('tiny', { kind: 'confirm_system', system: 2 });
    await writeFile(path.join(lib, 'tiny.musicxml'), SCORE.replace('Tiny', 'Tiny2'));
    const piece = await review.piece('tiny');
    expect(piece.state.verified).toBe(false);
    expect(piece.state.externalChange).toBe(true);
  });
});

// Stand-ins for review_queue.py and review_layout.py, run by the project's own Python.
const PYTHON = path.resolve('.venv/Scripts/python.exe');
const FAKE_QUEUE = String.raw`
import json, os, sys, hashlib
cmd, lib, slug, ident = sys.argv[1], sys.argv[3], sys.argv[4], sys.argv[5]
mode = open(os.path.join(lib, 'mode.txt')).read().strip()
score = os.path.join(lib, slug + '.musicxml')
sha = lambda: hashlib.sha256(open(score, 'rb').read()).hexdigest()
props = os.path.join(lib, 'review', slug + '.proposals')
if cmd == 'propose':
    if mode == 'deferred':
        print(json.dumps({'ok': False, 'error': 'Solace is short of memory; the check will wait.'})); sys.exit(4)
    os.makedirs(props, exist_ok=True)
    rec = {'id': 'p1', 'mark': ident, 'status': 'ready', 'reason': None, 'explanation': 'C5 should be C4.',
           'edits': [], 'measure': 3, 'staff': 1, 'base_sha256': sha(), 'crop': '', 'proposed': '',
           'created': 1, 'rejections_seen': 0}
    json.dump(rec, open(os.path.join(props, 'p1.json'), 'w'))
    print(json.dumps({'ok': True, 'proposal': rec}))
else:
    rec = json.load(open(os.path.join(props, ident + '.json')))
    before = sha()
    if before != rec['base_sha256']:
        print(json.dumps({'ok': False, 'error': 'The score changed since this was checked.'})); sys.exit(5)
    open(score, 'a').write('<!-- fixed -->\n')
    print(json.dumps({'ok': True, 'before': before, 'after': sha(), 'proposal': ident, 'mark': rec['mark'], 'log': []}))
`;
const FAKE_LAYOUT = String.raw`
import json, os, sys, hashlib
lib, slug = sys.argv[2], sys.argv[3]
p = os.path.join(lib, 'review', slug + '.layout.json')
d = json.load(open(p))
d['score_sha256'] = hashlib.sha256(open(os.path.join(lib, slug + '.musicxml'), 'rb').read()).hexdigest()
json.dump(d, open(p, 'w'))
`;

describe.runIf(existsSync(PYTHON))('vision re-checks', () => {
  beforeEach(async () => {
    const scripts = path.join(lib, 'scripts');
    await mkdir(scripts);
    await writeFile(path.join(scripts, 'review_queue.py'), FAKE_QUEUE);
    await writeFile(path.join(scripts, 'review_layout.py'), FAKE_LAYOUT);
    await writeFile(path.join(lib, 'mode.txt'), 'ok');
    await writeFile(path.join(lib, 'review-pages', 'tiny', 's02.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
    review = new Review({ library: lib, python: PYTHON, scripts });
  });

  const settle = async (mark: string) => {
    for (let i = 0; i < 100; i++) {
      const piece = await review.piece('tiny');
      if (piece.checks[mark]?.state !== 'checking') return piece;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('the check never finished');
  };

  it('a mark is checked on its own; Accept applies the fix and logs it', async () => {
    const marked = await review.append('tiny', { kind: 'mark', system: 2, measure: 3, staff: 1 });
    const mark = marked.state.marks[0].id;
    expect(marked.checks[mark]).toEqual({ state: 'checking' });
    const ready = await settle(mark);
    expect(ready.checks[mark]).toMatchObject({ state: 'done', proposal: { id: 'p1', status: 'ready' } });

    const done = await review.accept('tiny', 'p1');
    expect(done.state.marks[0].status).toBe('applied');
    expect(done.sha).not.toBe(sha);
    expect(done.layout?.score_sha256).toBe(done.sha);
    const accept = done.events.find((e) => e.kind === 'accept');
    expect(accept).toMatchObject({ mark, before: sha, after: done.sha, proposal: 'p1', origin: 'solace' });
    await expect(review.accept('tiny', 'p1')).rejects.toThrow(/no longer open/);
  });

  it('"still wrong" asks again; a changed score refuses Accept', async () => {
    const mark = (await review.append('tiny', { kind: 'mark', system: 2, measure: 3, staff: 1 })).state.marks[0].id;
    await settle(mark);
    const again = await review.append('tiny', { kind: 'reject', mark, note: 'the bass is wrong too' });
    expect(again.checks[mark]).toEqual({ state: 'checking' });
    await settle(mark);
    await writeFile(path.join(lib, 'tiny.musicxml'), SCORE.replace('Tiny', 'Tiny2'));
    await expect(review.accept('tiny', 'p1')).rejects.toThrow(/changed since this was checked/);
  });

  it('low memory holds the check and says why', async () => {
    await writeFile(path.join(lib, 'mode.txt'), 'deferred');
    const mark = (await review.append('tiny', { kind: 'mark', system: 2, measure: 3, staff: 1 })).state.marks[0].id;
    const held = await settle(mark);
    expect(held.checks[mark]).toEqual({ state: 'waiting', reason: 'Solace is short of memory; the check will wait.' });
  });

  it('a mark without a bar is never sent to the checker', async () => {
    const piece = await review.append('tiny', { kind: 'mark', system: 2, measure: null });
    expect(piece.checks[piece.state.marks[0].id]).toMatchObject({ state: 'waiting' });
  });
});
