import { describe, expect, it } from 'vitest';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import type { XmlImpl } from '../src/shared/fingering';
import { applyQueued, droppedLine, isFinalSaveError, waitingLine } from '../src/renderer/components/score/unsavedEdits';
import type { UnsavedEdit } from '../src/main/scoreFiles';

const impl: XmlImpl = {
  parse: (s) => new DOMParser().parseFromString(s, 'text/xml') as unknown as Document,
  serialize: (d) => new XMLSerializer().serializeToString(d as never),
};

const note = (step: string, octave: number) =>
  `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>4</duration><staff>1</staff></note>`;
const score = `<score-partwise><part id="P1"><measure number="1"><attributes><divisions>4</divisions></attributes>${note('C', 4)}${note('E', 4)}</measure></part></score-partwise>`;
const edit = (midi: number, digit: string | null, at = 1): UnsavedEdit => ({ stem: 'p', measure: 1, staff: 1, onset: midi === 60 ? 0 : 1, midi, digit, name: 'n', at });
const fingers = (xml: string) => [...xml.matchAll(/<fingering>(\d)<\/fingering>/g)].map((m) => m[1]);

describe('applyQueued (#6654)', () => {
  it('puts queued fingers back in order, later edits winning', () => {
    const r = applyQueued(score, [edit(60, '1'), edit(64, '3'), edit(60, '2')], impl);
    expect(r.applied).toHaveLength(3);
    expect(r.dropped).toEqual([]);
    expect(fingers(r.xml)).toEqual(['2', '3']);
  });

  it('is a no-op when re-applied', () => {
    const once = applyQueued(score, [edit(60, '1')], impl).xml;
    expect(applyQueued(once, [edit(60, '1')], impl).xml).toBe(once);
  });

  it('drops an edit whose note is no longer in the score, never moving it to another note', () => {
    const r = applyQueued(score, [{ ...edit(62, '4'), onset: 0 }], impl);
    expect(r.applied).toEqual([]);
    expect(r.dropped).toHaveLength(1);
    expect(r.xml).toBe(score);
    expect(droppedLine(r.dropped)).toContain('bar 1');
  });
});

describe('save messages', () => {
  it('tells final errors from ones worth retrying', () => {
    expect(isFinalSaveError("Error invoking remote method 'pieces:writeScore': Error: bad piece name")).toBe(true);
    expect(isFinalSaveError('Error: no such piece')).toBe(true);
    expect(isFinalSaveError('EBUSY: resource busy or locked')).toBe(false);
  });

  it('says how many changes wait, in plain words', () => {
    expect(waitingLine(1)).toContain('1 change kept');
    expect(waitingLine(3)).toContain('3 changes kept');
    expect(droppedLine([])).toBe('');
  });
});
