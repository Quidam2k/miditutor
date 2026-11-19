import { describe, expect, it } from 'vitest';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { dropChordRests } from '../src/renderer/engine/chordRests';

const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml') as unknown as Document;
const serialize = (doc: Document) => new XMLSerializer().serializeToString(doc as unknown as Node);
const drop = (xml: string) => dropChordRests(xml, parse, serialize);

const score = (...measures: string[]) =>
  '<score-partwise version="4.0">' +
  '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>' +
  '<part id="P1">' +
  measures.map((body, i) => `<measure number="${i + 1}">${
    i === 0 ? '<attributes><divisions>2</divisions><staves>2</staves></attributes>' : ''
  }${body}</measure>`).join('') +
  '</part></score-partwise>';

const pitch = (step: string, octave: number) =>
  `<pitch><step>${step}</step><octave>${octave}</octave></pitch>`;
const note = (body: string, staff = 1, voice = 1, type = 'quarter') =>
  `<note>${body}<duration>${type === 'whole' ? 8 : 2}</duration>` +
  `<voice>${voice}</voice><type>${type}</type><staff>${staff}</staff></note>`;
const notes = (xml: string) => Array.from(parse(xml).getElementsByTagName('note'));
const chordRests = (elements: Element[]) => elements.filter(
  (element) => element.getElementsByTagName('chord').length && element.getElementsByTagName('rest').length,
);
const pitches = (elements: Element[]) => elements.flatMap((element) => {
  const pitched = element.getElementsByTagName('pitch')[0];
  if (!pitched) return [];
  return [`${pitched.getElementsByTagName('step')[0].textContent}${pitched.getElementsByTagName('octave')[0].textContent}`];
});

describe('dropChordRests', () => {
  it('drops the New World chord rest and preserves the pitched notes in order', () => {
    const xml = score(
      note(pitch('C', 4)) + note(pitch('E', 4)) + note(pitch('G', 4)) + note(pitch('D', 5)) +
      '<backup><duration>8</duration></backup>' +
      note(pitch('F', 3), 2, 5, 'whole') + note('<chord/><rest/>', 2, 5, 'whole'),
    );
    const before = notes(xml);
    const after = notes(drop(xml));

    expect(chordRests(after)).toHaveLength(0);
    expect(after).toHaveLength(before.length - 1);
    expect(pitches(after)).toContain('F3');
    expect(pitches(after)).toEqual(pitches(before));
  });

  it('keeps an ordinary rest and returns the original XML for a real chord', () => {
    const xml = score(note(pitch('C', 4)) + note('<chord />' + pitch('E', 4)) + note('<rest/>'));
    const result = drop(xml);
    const after = notes(result);

    expect(result).toBe(xml);
    expect(after).toHaveLength(notes(xml).length);
    expect(after.filter((element) => element.getElementsByTagName('rest').length)).toHaveLength(1);
  });

  it('returns the original XML when there is no chord marker', () => {
    const xml = score(note(pitch('C', 4)) + note('<rest/>'));
    expect(drop(xml)).toBe(xml);
  });

  it('returns the original XML when the parsed document contains a parsererror element', () => {
    const xml = score('<parsererror/>' + note(pitch('C', 4)) + note('<chord/><rest/>'));
    expect(drop(xml)).toBe(xml);
  });

  it('drops chord rests from both measures', () => {
    const xml = score(
      note(pitch('C', 4)) + note('<chord/><rest/>'),
      note(pitch('E', 4)) + note('<chord /><rest/>'),
    );
    const after = notes(drop(xml));

    expect(chordRests(after)).toHaveLength(0);
    expect(after).toHaveLength(2);
    expect(pitches(after)).toEqual(['C4', 'E4']);
  });
});
