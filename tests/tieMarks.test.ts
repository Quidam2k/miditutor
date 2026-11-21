// #6661: tie marks (hold / tie to next), their queue and the day-first score backup.
import { describe, it, expect } from 'vitest';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isNoteMark,
  setMark,
  nextSamePitch,
  holdsOf,
  type FingerResult,
  type XmlImpl,
} from '../src/shared/fingering';
import { applyQueued } from '../src/renderer/components/score/unsavedEdits';
import { backupOnce, readUnsaved } from '../src/main/scoreFiles';

const impl: XmlImpl = {
  parse: (s: string) => new DOMParser().parseFromString(s, 'text/xml') as any,
  serialize: (d: any) => new XMLSerializer().serializeToString(d),
} as XmlImpl;

const STEPS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const midiOf = (step: string, oct: number, alter = 0) => 12 * (oct + 1) + STEPS[step] + alter;

interface NoteOpts { alter?: number; staff?: number; chord?: boolean; grace?: boolean; rest?: boolean; dur?: number }

function note(step: string, oct: number, o: NoteOpts = {}): string {
  const pitch = o.rest
    ? '<rest/>'
    : `<pitch><step>${step}</step>${o.alter ? `<alter>${o.alter}</alter>` : ''}<octave>${oct}</octave></pitch>`;
  return `<note>${o.grace ? '<grace/>' : ''}${o.chord ? '<chord/>' : ''}${pitch}${
    o.grace ? '' : `<duration>${o.dur ?? 1}</duration>`
  }<staff>${o.staff ?? 1}</staff></note>`;
}

function score(...measures: string[][]): string {
  const body = measures
    .map((m, i) => `<measure number="${i + 1}">${i === 0 ? '<attributes><divisions>1</divisions><staves>2</staves></attributes>' : ''}${m.join('')}</measure>`)
    .join('');
  return `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"/></part-list><part id="P1">${body}</part></score-partwise>`;
}

const A4 = midiOf('A', 4);
const xmlOf = (r: FingerResult) => {
  if (!r.ok) throw new Error(r.reason);
  return r.xml;
};
const tgt = (measure: number, onset: number, midi = A4, staff = 1) => ({ measure, staff, onset, midi });

describe('nextSamePitch', () => {
  it('finds same pitch later in the bar', () => {
    const xml = score([note('A', 4), note('C', 5), note('A', 4)]);
    expect(nextSamePitch(xml, tgt(1, 0), impl)).toMatchObject({ measure: 1, onset: 2, midi: A4 });
  });
  it('crosses a bar line', () => {
    const xml = score([note('A', 4, { dur: 4 })], [note('A', 4)]);
    expect(nextSamePitch(xml, tgt(1, 0), impl)).toMatchObject({ measure: 2, onset: 0 });
  });
  it('skips rests', () => {
    const xml = score([note('A', 4), note('C', 5, { rest: true }), note('C', 5, { rest: true }), note('A', 4)]);
    expect(nextSamePitch(xml, tgt(1, 0), impl)).toMatchObject({ measure: 1, onset: 3 });
  });
  it('ignores same-onset chord member (strictly later only)', () => {
    const xml = score([note('A', 4), note('A', 4, { chord: true, alter: 0 })], [note('A', 4)]);
    expect(nextSamePitch(xml, tgt(1, 0), impl)).toMatchObject({ measure: 2, onset: 0 });
  });
  it('ignores the other staff', () => {
    const xml = score([note('A', 4, { dur: 4 }), '<backup><duration>4</duration></backup>', note('A', 4, { staff: 2, dur: 4 })]);
    expect(nextSamePitch(xml, tgt(1, 0), impl)).toBeNull();
  });
  it('ignores a different alter', () => {
    const xml = score([note('A', 4), note('A', 4, { alter: -1 })]);
    expect(midiOf('A', 4, -1)).toBe(A4 - 1);
    expect(nextSamePitch(xml, tgt(1, 0), impl)).toBeNull();
  });
  it('skips grace notes', () => {
    const xml = score([note('A', 4), note('A', 4, { grace: true }), note('A', 4)]);
    expect(nextSamePitch(xml, tgt(1, 0), impl)).toMatchObject({ measure: 1, onset: 1 });
  });
  it('skips the far end of a printed tie (Sorcerer bar 1 into bar 2)', () => {
    const tied = note('A', 4, { dur: 2 }).replace('<duration>', '<tie type="start"/><duration>');
    const stop = note('A', 4, { dur: 2 }).replace('<duration>', '<tie type="stop"/><duration>');
    const xml = score([tied, stop], [note('C', 5, { rest: true, dur: 2 }), note('A', 4, { dur: 2 })]);
    expect(nextSamePitch(xml, tgt(1, 0), impl)).toMatchObject({ measure: 2, onset: 2 });
    expect(nextSamePitch(xml, tgt(1, 2), impl)).toMatchObject({ measure: 2, onset: 2 });
  });
  it('skips cue notes', () => {
    const cue = note('A', 4).replace('<pitch>', '<cue/><pitch>');
    const xml = score([note('A', 4), cue, note('A', 4)]);
    expect(nextSamePitch(xml, tgt(1, 0), impl)).toMatchObject({ measure: 1, onset: 2 });
  });
  it('returns null when none found or xml is bad', () => {
    expect(nextSamePitch(score([note('A', 4), note('C', 5)]), tgt(1, 0), impl)).toBeNull();
    expect(nextSamePitch('<<not xml', tgt(1, 0), impl)).toBeNull();
  });
});

describe('isNoteMark', () => {
  it('accepts valid marks', () => {
    for (const v of [null, '1', '2', '3', '4', '5', 'hold', 'unhold']) expect(isNoteMark(v)).toBe(true);
  });
  it('rejects invalid marks', () => {
    for (const v of ['0', '6', '', undefined, 'Hold', 3]) expect(isNoteMark(v as any)).toBe(false);
  });
});

describe('setMark', () => {
  const xml = score([note('A', 4), note('C', 5)]);
  const t = tgt(1, 0);
  const hasHold = (x: string) => holdsOf(x, impl).some((h: any) => h.measure === 1 && h.onset === 0 && h.midi === A4);

  it('hold then unhold', () => {
    const held = xmlOf(setMark(xml, t, 'hold', impl));
    expect(hasHold(held)).toBe(true);
    const un = xmlOf(setMark(held, t, 'unhold', impl));
    expect(hasHold(un)).toBe(false);
  });
  it('sets and clears a fingering', () => {
    const f = xmlOf(setMark(xml, t, '3', impl));
    expect(f).toContain('<fingering>3</fingering>');
    const cleared = xmlOf(setMark(f, t, null, impl));
    expect(cleared).not.toContain('<fingering>');
  });
  it('hold and finger coexist', () => {
    const a = xmlOf(setMark(xml, t, 'hold', impl));
    const b = xmlOf(setMark(a, t, '2', impl));
    expect(b).toContain('<fingering>2</fingering>');
    expect(hasHold(b)).toBe(true);
  });
});

describe('applyQueued', () => {
  const xml = score([note('A', 4), note('C', 5)]);
  const edit = (o: object) => ({ stem: 's', measure: 1, staff: 1, onset: 0, midi: A4, digit: '1', name: 'n', at: 0, ...o });

  it('applies finger and hold edits', () => {
    const r: any = applyQueued(xml, [edit({ digit: '4' }), edit({ onset: 1, midi: midiOf('C', 5), digit: 'hold' })] as any, impl);
    expect(r.dropped).toHaveLength(0);
    expect(r.xml).toContain('<fingering>4</fingering>');
    expect(holdsOf(r.xml, impl).length).toBeGreaterThan(0);
  });
  it('drops a hold edit for a missing note', () => {
    const r: any = applyQueued(xml, [edit({ onset: 3, digit: 'hold' })] as any, impl);
    expect(r.dropped).toHaveLength(1);
    expect(r.dropped[0].reason).toBe('no such note');
  });
});

describe('backupOnce', () => {
  it('copies once per day', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tie-'));
    try {
      const file = path.join(dir, 'song.musicxml');
      const root = path.join(dir, 'bk');
      fs.writeFileSync(file, 'original');
      const first = await backupOnce(file, root, '2024-01-01');
      expect(first).toBe(path.join(root, '2024-01-01', 'song.musicxml'));
      expect(fs.readFileSync(first as string, 'utf8')).toBe('original');

      fs.writeFileSync(file, 'changed');
      expect(await backupOnce(file, root, '2024-01-01')).toBeNull();
      expect(fs.readFileSync(first as string, 'utf8')).toBe('original');

      const next = await backupOnce(file, root, '2024-01-02');
      expect(next).toBe(path.join(root, '2024-01-02', 'song.musicxml'));
      expect(fs.readFileSync(next as string, 'utf8')).toBe('changed');

      expect(await backupOnce(path.join(dir, 'missing.xml'), root, '2024-01-03')).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('backupOnce never blocks the save', () => {
  it('returns null (no throw) when the backup folder cannot be made', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tie-'));
    try {
      const file = path.join(dir, 'song.musicxml');
      fs.writeFileSync(file, 'original');
      const blocker = path.join(dir, 'bk');
      fs.writeFileSync(blocker, 'a file where the folder should be');
      expect(await backupOnce(file, blocker, '2024-01-01')).toBeNull();
      expect(fs.readdirSync(dir).sort()).toEqual(['bk', 'song.musicxml']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('readUnsaved', () => {
  it('keeps hold/unhold and drops bogus digits', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tie-'));
    try {
      const file = path.join(dir, 'unsaved.json');
      const e = (digit: string) => ({ stem: 's', measure: 1, staff: 1, onset: 0, midi: A4, digit, name: 'n', at: 0 });
      fs.writeFileSync(file, JSON.stringify([e('hold'), e('unhold'), e('bogus')]));
      const out: any[] = await (readUnsaved as any)(file);
      expect(out.map((x) => x.digit)).toEqual(['hold', 'unhold']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
