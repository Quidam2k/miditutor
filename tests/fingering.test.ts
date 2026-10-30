import { describe, expect, it } from 'vitest';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import {
  holdsOf,
  setFingering,
  setHold,
  type Digit,
  type FingerTarget,
  type XmlImpl,
} from '../src/shared/fingering';
import { nextFinger, prevPlayable, stepOfBar } from '../src/renderer/components/score/noteEdit';

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

// #10146: Sorcerer's Apprentice bar 3, the 8va A-flat JP has him hold on the pedal.
describe('setHold / holdsOf', () => {
  const ab6 = { measure: 2, staff: 1, onset: 3, midi: 92 };
  const twoBars = `<score-partwise><part id="P1">
    <measure number="2"><attributes><divisions>2</divisions></attributes>${note('C', 4).replace('<duration>4', '<duration>18')}</measure>
    <measure number="3">${note('A', 5, '', '', '<alter>-1</alter>').replace('<duration>4', '<duration>6')}${note('A', 6, '<voice>1</voice><notations><slur type="start"/></notations><lyric><text>la</text></lyric>', '', '<alter>-1</alter>').replace('<duration>4', '<duration>3')}</measure>
  </part></score-partwise>`;

  it('adds a hold that holdsOf finds, after the lyric, keeping the slur', () => {
    const result = setHold(twoBars, ab6, true, impl);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(holdsOf(result.xml, impl)).toEqual([ab6]);
    expect(result.xml).toContain('<lyric><text>la</text></lyric><play><other-play type="miditutor">hold</other-play></play>');
    expect(result.xml).toContain('<slur type="start"/>');
  });

  it('is idempotent and removes cleanly', () => {
    const once = setHold(twoBars, ab6, true, impl);
    if (!once.ok) throw new Error(once.reason);
    const twice = setHold(once.xml, ab6, true, impl);
    if (!twice.ok) throw new Error(twice.reason);
    expect(twice.xml.match(/other-play/g)?.length).toBe(2); // open + close tag: one mark
    const off = setHold(twice.xml, ab6, false, impl);
    if (!off.ok) throw new Error(off.reason);
    expect(off.xml).not.toContain('<play');
    expect(holdsOf(off.xml, impl)).toEqual([]);
  });

  it('refuses a note that is not there', () => {
    expect(setHold(twoBars, { ...ab6, midi: 80 }, true, impl)).toEqual({ ok: false, reason: 'no such note' });
  });

  it('keeps a play element that holds other things', () => {
    const withPlay = twoBars.replace('<lyric>', '<play><mute>straight</mute></play><lyric>');
    const on = setHold(withPlay, ab6, true, impl);
    if (!on.ok) throw new Error(on.reason);
    const off = setHold(on.xml, ab6, false, impl);
    if (!off.ok) throw new Error(off.reason);
    expect(off.xml).toContain('<play><mute>straight</mute></play>');
  });
});

describe('wheel steps (#10237)', () => {
  it('counts up from 1 and down from 5 on an empty note', () => {
    expect(nextFinger(null, true)).toBe('1');
    expect(nextFinger(undefined, false)).toBe('5');
  });
  it('steps a marked note and comes off past either end', () => {
    expect(nextFinger('3', true)).toBe('4');
    expect(nextFinger('3', false)).toBe('2');
    expect(nextFinger('5', true)).toBeNull();
    expect(nextFinger('1', false)).toBeNull();
  });
  it('finds the first step of the next or previous bar, not past the ends', () => {
    const steps = [{ measure: 1 }, { measure: 1 }, { measure: 2 }, { measure: 3 }];
    expect(stepOfBar(steps, 1, 1)).toBe(2);
    expect(stepOfBar(steps, 3, -1)).toBe(2);
    expect(stepOfBar(steps, 3, 1)).toBeNull();
    expect(stepOfBar(steps, 1, -1)).toBeNull();
  });
  it('Prev steps over a tie-only step instead of landing on it (#10245)', () => {
    const steps = [{ notes: [47, 49] }, { notes: [] }, { notes: [60] }, { notes: [] }, { notes: [62] }];
    expect(prevPlayable(steps, 2)).toBe(0);
    expect(prevPlayable(steps, 4)).toBe(2);
    expect(prevPlayable(steps, 1)).toBe(0);
    expect(prevPlayable(steps, 0)).toBeNull();
    expect(prevPlayable([{ notes: [] }, { notes: [60] }], 1)).toBeNull();
    expect(prevPlayable(steps, 99)).toBe(4);
  });
});
