import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { spliceMix, type MixChoice, type MixSection } from '../src/shared/mix';

const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml') as unknown as Document;
const serialize = (doc: Document) => new XMLSerializer().serializeToString(doc as unknown as Node);
const mix = (e: string, h: string, sections: MixSection[], choice: MixChoice[], semis = -2) =>
  parse(spliceMix(e, h, sections, choice, semis, 'Song', parse, serialize));

const n = (step: string, octave: number, alter?: number, extra = '') =>
  `<note><pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${octave}</octave></pitch>` +
  `<duration>1</duration><voice>1</voice><staff>1</staff>${extra}</note>`;
const key = (f: number) => `<key><fifths>${f}</fifths></key>`;
const clef = (num: number, sign: string, line: number) => `<clef number="${num}"><sign>${sign}</sign><line>${line}</line></clef>`;
const score = (head: string, measures: string) =>
  `<score-partwise version="4.0">${head}<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>` +
  `<part id="P1">${measures}</part></score-partwise>`;
const measure = (num: number, attrs: string, body: string, open = '') =>
  `<measure number="${num}"${open}>${attrs ? `<attributes>${attrs}</attributes>` : ''}${body}</measure>`;

const EASY = score('<work><work-title>Song (easy)</work-title></work>', [
  measure(1, `<divisions>2</divisions>${key(0)}<time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>${clef(1, 'G', 2)}${clef(2, 'F', 4)}`, n('C', 5) + n('E', 5)),
  measure(2, '', n('D', 5) + n('F', 5)),
  measure(3, '', n('E', 5) + n('G', 5)),
  measure(4, '', n('F', 5) + n('A', 5)),
].join(''));

const HARDER = score('<movement-title>Song (harder)</movement-title>', [
  measure(1, `<divisions>4</divisions>${key(2)}<time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>${clef(1, 'G', 2)}${clef(2, 'F', 4)}`,
    '<harmony><root><root-step>D</root-step></root></harmony>' + n('F', 5, 1, '<accidental>sharp</accidental>') + n('C', 5, 1)),
  `<measure number="2"><print new-system="yes"/>` + n('D', 5) + n('B', 4, -1) + '</measure>',
  measure(3, clef(1, 'F', 4), n('F', 3, 1) + n('G', 3)),
  measure(4, '', n('A', 3) + n('B', 3)),
].join(''));

const measures = (doc: Document) => Array.from(doc.getElementsByTagName('measure'));
const pitches = (m: Element) =>
  Array.from(m.getElementsByTagName('pitch')).map((p) => {
    const alter = Number(p.getElementsByTagName('alter')[0]?.textContent ?? 0);
    return p.getElementsByTagName('step')[0].textContent + (alter > 0 ? '#'.repeat(alter) : 'b'.repeat(-alter)) +
      p.getElementsByTagName('octave')[0].textContent;
  });
const attr = (m: Element, tag: string) => m.getElementsByTagName('attributes')[0]?.getElementsByTagName(tag)[0];
const all = (e: Element, tag: string) => Array.from(e.getElementsByTagName(tag));

const ALL: MixSection[] = [{ easy: [1, 4], harder: [1, 4] }];
const HALVES: MixSection[] = [{ easy: [1, 2], harder: [1, 2] }, { easy: [3, 4], harder: [3, 4] }];

describe('spliceMix', () => {
  it('an easy-only choice keeps the easy notes, renumbered', () => {
    const doc = mix(EASY, HARDER, [{ easy: [2, 3], harder: [2, 3] }, { easy: [1, 1], harder: [1, 1] }], ['easy', 'easy']);
    const ms = measures(doc);
    expect(ms.map((m) => m.getAttribute('number'))).toEqual(['1', '2', '3']);
    expect(ms.map(pitches)).toEqual([['D5', 'F5'], ['E5', 'G5'], ['C5', 'E5']]);
    expect(attr(ms[0], 'divisions')?.textContent).toBe('2');
    expect(attr(ms[0], 'clef')?.getElementsByTagName('sign')[0].textContent).toBe('G');
    expect(doc.getElementsByTagName('direction').length).toBe(0);
  });

  it('transposes a harder section into the easy key and respells it', () => {
    const doc = mix(EASY, HARDER, ALL, ['harder']);
    const ms = measures(doc);
    expect(pitches(ms[0])).toEqual(['E5', 'B4']); // F#5 -> E5, C#5 -> B4
    expect(pitches(ms[1])).toEqual(['C5', 'Ab4']); // D5 -> C5, Bb4 -> Ab4
    expect(pitches(ms[2])).toEqual(['E3', 'F3']); // F#3 -> E3, G3 -> F3 (low clef bar)
    expect(doc.getElementsByTagName('accidental').length).toBe(0);
    expect(doc.getElementsByTagName('harmony').length).toBe(0);
    expect(doc.getElementsByTagName('print').length).toBe(0);
  });

  it('transposes upward and leaves pitches alone at semis 0', () => {
    const inD = EASY.replace('<fifths>0</fifths>', '<fifths>2</fifths>');
    const up = measures(mix(inD, EASY, ALL, ['harder'], 2));
    expect(pitches(up[0])).toEqual(['D5', 'F#5']);
    expect(attr(up[0], 'key')?.getElementsByTagName('fifths')[0].textContent).toBe('2');
    expect(pitches(measures(mix(EASY, HARDER, ALL, ['harder'], 0))[0])).toEqual(['F#5', 'C#5']);
  });

  it('restores divisions and clefs when going back to easy after a harder segment', () => {
    const ms = measures(mix(EASY, HARDER, HALVES, ['harder', 'easy']));
    expect(attr(ms[0], 'divisions')?.textContent).toBe('4');
    expect(attr(ms[2], 'divisions')?.textContent).toBe('2');
    const clefs = all(ms[2].getElementsByTagName('attributes')[0], 'clef');
    expect(clefs.map((c) => c.getAttribute('number') + c.getElementsByTagName('sign')[0].textContent)).toEqual(['1G', '2F']);
    expect(attr(ms[2], 'staves')?.textContent).toBe('2');
    expect(attr(ms[2], 'time')?.getElementsByTagName('beats')[0].textContent).toBe('4');
  });

  it('carries the harder clef change into a segment that starts on it', () => {
    const ms = measures(mix(EASY, HARDER, HALVES, ['easy', 'harder']));
    const clefs = all(ms[2].getElementsByTagName('attributes')[0], 'clef');
    expect(clefs.map((c) => c.getAttribute('number') + c.getElementsByTagName('sign')[0].textContent)).toEqual(['1F', '2F']);
    expect(attr(ms[2], 'divisions')?.textContent).toBe('4');
  });

  it('writes the easy key everywhere and keeps attribute child order', () => {
    const doc = mix(EASY, HARDER, HALVES, ['harder', 'easy']);
    const fifths = all(doc.documentElement, 'fifths').map((f) => f.textContent);
    expect(fifths.length).toBeGreaterThanOrEqual(2);
    expect(new Set(fifths)).toEqual(new Set(['0']));
    const order = Array.from(measures(doc)[0].getElementsByTagName('attributes')[0].childNodes)
      .filter((c) => c.nodeType === 1).map((c) => (c as Element).tagName);
    expect(order).toEqual(['divisions', 'key', 'time', 'staves', 'clef', 'clef']);
  });

  it('adds the no-fingering direction once per harder segment', () => {
    const words = (doc: Document) => all(doc.documentElement, 'words').map((w) => w.textContent);
    const three: MixSection[] = [{ easy: [1, 1], harder: [1, 1] }, { easy: [2, 2], harder: [2, 2] }, { easy: [3, 4], harder: [3, 4] }];
    expect(words(mix(EASY, HARDER, three, ['harder', 'harder', 'easy']))).toEqual(['Harder: no fingering']);
    expect(words(mix(EASY, HARDER, three, ['harder', 'easy', 'harder']))).toEqual(['Harder: no fingering', 'Harder: no fingering']);
    const m = measures(mix(EASY, HARDER, three, ['harder', 'easy', 'easy']))[0];
    const tags = Array.from(m.childNodes).filter((c) => c.nodeType === 1).map((c) => (c as Element).tagName);
    expect(tags.slice(0, 2)).toEqual(['attributes', 'direction']);
  });

  it('sets the title on work-title, or on movement-title when present', () => {
    expect(mix(EASY, HARDER, ALL, ['easy']).getElementsByTagName('work-title')[0].textContent).toBe('Song (My mix)');
    const withMovement = EASY.replace('<work>', '<movement-title>M</movement-title><work>');
    const doc = mix(withMovement, HARDER, ALL, ['easy']);
    expect(doc.getElementsByTagName('movement-title')[0].textContent).toBe('Song (My mix)');
    expect(doc.getElementsByTagName('work-title')[0].textContent).toBe('Song (easy)');
    const bare = mix(EASY.replace(/<work>.*<\/work>/, ''), HARDER, ALL, ['easy']);
    expect((bare.documentElement.firstChild as Element).tagName).toBe('work');
    expect(bare.getElementsByTagName('work-title')[0].textContent).toBe('Song (My mix)');
  });

  it('removes implicit from all but the first bar', () => {
    const pickup = EASY.replace('<measure number="2">', '<measure number="2" implicit="yes">');
    const ms = measures(mix(pickup, HARDER, ALL, ['easy']));
    expect(ms.map((m) => m.hasAttribute('implicit'))).toEqual([false, false, false, false]);
  });

  it('throws on a length mismatch, a missing bar, or an unparseable or multi-part score', () => {
    expect(() => mix(EASY, HARDER, HALVES, ['easy'])).toThrow(/choices/);
    expect(() => mix(EASY, HARDER, [{ easy: [1, 4], harder: [3, 9] }], ['harder'])).toThrow(/bar 5/);
    expect(() => mix(EASY, HARDER, [{ easy: [3, 6], harder: [1, 4] }], ['easy'])).toThrow(/bar 5/);
    expect(() => spliceMix('<oops', HARDER, ALL, ['easy'], -2, 'S', parse, serialize)).toThrow();
    const two = EASY.replace('</score-partwise>', '<part id="P2"><measure number="1"/></part></score-partwise>');
    expect(() => mix(two, HARDER, ALL, ['easy'])).toThrow(/parts/);
  });
});

const LIBRARY = 'Q:/Personal/piano/library/';
describe('spliceMix on the real O scores', () => {
  it.skipIf(!existsSync(`${LIBRARY}o-from-o.musicxml`))('splices harder 1-8 then easy 9-34', () => {
    const easy = readFileSync(`${LIBRARY}o-from-o.musicxml`, 'utf8');
    const harder = readFileSync(`${LIBRARY}o-musicnotes-arrangement.musicxml`, 'utf8');
    const doc = mix(easy, harder, [{ easy: [1, 8], harder: [1, 8] }, { easy: [9, 34], harder: [9, 34] }], ['harder', 'easy']);
    const ms = measures(doc);
    expect(ms.length).toBe(34);
    expect(attr(ms[8], 'divisions')?.textContent).toBe('6');
    expect(attr(ms[8], 'key')?.getElementsByTagName('fifths')[0].textContent).toBe('0');
    expect(attr(ms[0], 'divisions')?.textContent).toBe('4');
  });
});
