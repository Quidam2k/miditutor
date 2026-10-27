import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
