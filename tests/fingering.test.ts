import { describe, expect, it } from 'vitest';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import {
  setFingering,
  type Digit,
  type FingerTarget,
  type XmlImpl,
} from '../src/shared/fingering';

const impl: XmlImpl = {
  parse: s => new DOMParser().parseFromString(s, 'text/xml') as unknown as Document,
  serialize: d => new XMLSerializer().serializeToString(d as never),
};

const target: FingerTarget = { measure: 1, staff: 1, onset: 0, midi: 60 };

function note(
  step = 'C',
  octave = 4,
  extra = '',
  prefix = '',
  alter = '',
): string {
  return `<note>${prefix}<pitch><step>${step}</step>${alter}<octave>${octave}</octave></pitch><duration>4</duration>${extra}</note>`;
}

function score(body: string): string {
  return `<score-partwise><part id="P1"><measure number="99"><attributes><divisions>4</divisions></attributes>${body}</measure></part></score-partwise>`;
}

function edited(
  xml: string,
  selected: FingerTarget = target,
  digit: Digit | null = '3',
): Document {
  const result = setFingering(xml, selected, digit, impl);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.reason);
  }
  return impl.parse(result.xml);
}

function fingerings(element: Document | Element): string[] {
  const found = element.getElementsByTagName('fingering');
  const result: string[] = [];
  for (let i = 0; i < found.length; i += 1) {
    result.push(found.item(i)?.textContent || '');
  }
  return result;
}

describe('setFingering', () => {
  it('adds fingering to a single note by measure position', () => {
    expect(fingerings(edited(score(note())))).toEqual(['3']);
  });

  it('replaces every existing fingering and keeps other technique marks', () => {
    const marks = '<notations><technical><fingering>1</fingering><up-bow/></technical><technical><fingering>2</fingering></technical></notations>';
    const doc = edited(score(note('C', 4, marks)));
    expect(fingerings(doc)).toEqual(['3']);
    expect(doc.getElementsByTagName('up-bow').length).toBe(1);
    expect(doc.getElementsByTagName('notations').length).toBe(1);
  });

  it('removes fingering and drops empty technical and notations', () => {
    const marks = '<notations>\n<technical>\n<fingering>1</fingering>\n</technical>\n</notations>';
    const doc = edited(score(note('C', 4, marks)), target, null);
    expect(fingerings(doc)).toEqual([]);
    expect(doc.getElementsByTagName('technical').length).toBe(0);
    expect(doc.getElementsByTagName('notations').length).toBe(0);
  });

  it('keeps other notation content when removing fingering', () => {
    const marks = '<notations><technical><fingering>1</fingering><up-bow/></technical><slur type="start"/></notations>';
    const doc = edited(score(note('C', 4, marks)), target, null);
    expect(fingerings(doc)).toEqual([]);
    expect(doc.getElementsByTagName('technical').length).toBe(1);
    expect(doc.getElementsByTagName('slur').length).toBe(1);
  });

  it('selects a chord note by midi at the shared onset', () => {
    const doc = edited(
      score(note() + note('E', 4, '', '<chord/>')),
      { ...target, midi: 64 },
    );
    const notes = doc.getElementsByTagName('note');
    expect(fingerings(notes.item(0)!)).toEqual([]);
    expect(fingerings(notes.item(1)!)).toEqual(['3']);
  });

  it('selects staff 2 after backup at onset zero', () => {
    const body = note('C', 4, '<staff>1</staff>') +
      '<backup><duration>4</duration></backup>' +
      note('C', 4, '<staff>2</staff>');
    const doc = edited(score(body), { ...target, staff: 2 });
    const notes = doc.getElementsByTagName('note');
    expect(fingerings(notes.item(0)!)).toEqual([]);
    expect(fingerings(notes.item(1)!)).toEqual(['3']);
  });

  it('uses the cursor after a forward', () => {
    const body = '<forward><duration>6</duration></forward>' + note();
    expect(fingerings(edited(score(body), { ...target, onset: 1.5 })))
      .toEqual(['3']);
  });

  it('rejects ambiguous notes in different voices', () => {
    const body = note('C', 4, '<voice>1</voice>') +
      '<backup><duration>4</duration></backup>' +
      note('C', 4, '<voice>2</voice>');
    const result = setFingering(score(body), target, '3', impl);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('ambiguous');
      expect(result.reason).toBe('ambiguous: 2 notes');
    }
  });

  it('rejects a missing match', () => {
    expect(setFingering(score(note()), { ...target, midi: 61 }, '3', impl))
      .toEqual({ ok: false, reason: 'no such note' });
  });

  it('rejects an out of range measure', () => {
    expect(setFingering(score(note()), { ...target, measure: 2 }, '3', impl))
      .toEqual({ ok: false, reason: 'measure out of range' });
  });

  it('matches B flat with alter -1', () => {
    const xml = score(note('B', 4, '', '', '<alter>-1</alter>'));
    expect(fingerings(edited(xml, { ...target, midi: 70 }))).toEqual(['3']);
  });

  it('inserts notations before the first lyric', () => {
    const doc = edited(score(note('C', 4, '<lyric><text>la</text></lyric>')));
    const selected = doc.getElementsByTagName('note').item(0)!;
    const tags: string[] = [];
    for (let i = 0; i < selected.childNodes.length; i += 1) {
      const node = selected.childNodes.item(i);
      if (node?.nodeType === 1) {
        tags.push((node as Element).localName);
      }
    }
    expect(tags).toEqual(['pitch', 'duration', 'notations', 'lyric']);
  });

  it('carries divisions across measures and only uses the first part', () => {
    const xml = `<score-partwise><part id="P1">
      <measure number="12"><attributes><divisions>4</divisions></attributes></measure>
      <measure number="42"><forward><duration>6</duration></forward>${note()}</measure>
      </part><part id="P2"><measure>${note()}</measure></part></score-partwise>`;
    const doc = edited(xml, { ...target, measure: 2, onset: 1.5 });
    const parts = doc.getElementsByTagName('part');
    expect(fingerings(parts.item(0)!)).toEqual(['3']);
    expect(fingerings(parts.item(1)!)).toEqual([]);
  });

  it('does not advance for a grace note and skips rests and unpitched notes', () => {
    const body = '<note><grace/><pitch><step>D</step><octave>4</octave></pitch></note>' +
      note() +
      '<note><rest/><duration>0</duration></note>' +
      '<note><unpitched/><duration>0</duration></note>';
    const doc = edited(score(body));
    expect(fingerings(doc.getElementsByTagName('note').item(1)!)).toEqual(['3']);
  });

  it('creates elements in the parent namespace', () => {
    const xml = score(note()).replace(
      '<score-partwise>',
      '<score-partwise xmlns="urn:test:musicxml">',
    );
    const doc = edited(xml);
    expect(doc.getElementsByTagName('fingering').item(0)?.namespaceURI)
      .toBe('urn:test:musicxml');
  });

  it('rejects a score without a part', () => {
    expect(setFingering('<score-partwise/>', target, '3', impl))
      .toEqual({ ok: false, reason: 'no <part>' });
  });

  it('returns a failure when the parser throws', () => {
    const broken: XmlImpl = {
      parse: () => {
        throw new Error('parse error');
      },
      serialize: impl.serialize,
    };
    expect(setFingering('<', target, '3', broken))
      .toEqual({ ok: false, reason: 'parse error' });
  });
});
