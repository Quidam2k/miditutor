import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { addBeams, beamGroups } from '../src/renderer/engine/autoBeam';
import { libraryDir } from './libraryDir';

const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml') as unknown as Document;
const serialize = (doc: Document) => new XMLSerializer().serializeToString(doc as unknown as Node);
const beam = (xml: string) => addBeams(xml, parse, serialize);

const note = (step: string, type: string, duration: number, extra = '') =>
  `<note>${extra.includes('<chord/>') ? '<chord/>' : ''}<pitch><step>${step}</step><octave>4</octave></pitch>` +
  `<duration>${duration}</duration><voice>1</voice><type>${type}</type>${extra.replace('<chord/>', '')}<staff>1</staff></note>`;
const rest = (type: string, duration: number) =>
  `<note><rest/><duration>${duration}</duration><voice>1</voice><type>${type}</type><staff>1</staff></note>`;
const piece = (beats: number, beatType: number, notes: string) =>
  `<score-partwise><part id="P1"><measure number="1"><attributes><divisions>2</divisions>` +
  `<time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time></attributes>${notes}</measure></part></score-partwise>`;

// One row per note: its step and its beam (or '-').
function beams(xml: string): string[] {
  const doc = parse(xml);
  return Array.from(doc.getElementsByTagName('note')).map((n) => {
    const step = n.getElementsByTagName('step')[0]?.textContent ?? 'r';
    return `${step}:${n.getElementsByTagName('beam')[0]?.textContent ?? '-'}`;
  });
}

describe('beamGroups (#6612: JP first, then Gould)', () => {
  it('compound time by the dotted quarter, 3/8 the whole bar', () => {
    expect(beamGroups(2, 3, 8)).toEqual([3]);
    expect(beamGroups(2, 6, 8)).toEqual([3, 3]);
    expect(beamGroups(2, 9, 8)).toEqual([3, 3, 3]);
    expect(beamGroups(2, 12, 8)).toEqual([3, 3, 3, 3]);
  });
  it('5/8 = 2+3, 7/8 = 2+2+3, 2/8 and 4/8 in twos', () => {
    expect(beamGroups(2, 5, 8)).toEqual([2, 3]);
    expect(beamGroups(2, 7, 8)).toEqual([2, 2, 3]);
    expect(beamGroups(2, 2, 8)).toEqual([2]);
    expect(beamGroups(2, 4, 8)).toEqual([2, 2]);
  });
  it('4/4 in half bars and 2/4 the whole bar, back to beats when a 16th is in it; 3/4 and 2/2 by the beat', () => {
    expect(beamGroups(2, 4, 4)).toEqual([4, 4]);
    expect(beamGroups(2, 4, 4, true)).toEqual([2, 2, 2, 2]);
    expect(beamGroups(2, 2, 4)).toEqual([4]);
    expect(beamGroups(2, 2, 4, true)).toEqual([2, 2]);
    expect(beamGroups(2, 3, 4)).toEqual([2, 2, 2]);
    expect(beamGroups(2, 2, 2)).toEqual([4, 4]);
  });
});

describe('addBeams', () => {
  it('6/8: two groups of three eighths', () => {
    const xml = piece(6, 8, ['C', 'D', 'E', 'F', 'G', 'A'].map((s) => note(s, 'eighth', 1)).join(''));
    expect(beams(beam(xml))).toEqual(['C:begin', 'D:continue', 'E:end', 'F:begin', 'G:continue', 'A:end']);
  });

  it('9/8: three groups of three, never across a dotted quarter', () => {
    const xml = piece(9, 8, ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C', 'D'].map((s) => note(s, 'eighth', 1)).join(''));
    expect(beams(beam(xml))).toEqual(['C:begin', 'D:continue', 'E:end', 'F:begin', 'G:continue', 'A:end', 'B:begin', 'C:continue', 'D:end']);
  });

  it('3/8: the whole bar is one beam', () => {
    const xml = piece(3, 8, ['C', 'D', 'E'].map((s) => note(s, 'eighth', 1)).join(''));
    expect(beams(beam(xml))).toEqual(['C:begin', 'D:continue', 'E:end']);
  });

  it('4/4: eight eighths beam as beats 1+2 and 3+4, never across the middle', () => {
    const xml = piece(4, 4, ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C'].map((s) => note(s, 'eighth', 1)).join(''));
    expect(beams(beam(xml))).toEqual(['C:begin', 'D:continue', 'E:continue', 'F:end', 'G:begin', 'A:continue', 'B:continue', 'C:end']);
  });

  it('4/4: a half bar holding 16ths splits back into beats', () => {
    // divisions 2 means a 16th has no whole duration, so this bar uses divisions 4.
    const xml = piece(4, 4, note('C', '16th', 1) + note('D', '16th', 1) + note('E', 'eighth', 2) + note('F', 'eighth', 2) +
      note('G', 'eighth', 2) + note('A', 'half', 8)).replace('<divisions>2</divisions>', '<divisions>4</divisions>');
    expect(beams(beam(xml))).toEqual(['C:begin', 'D:continue', 'E:end', 'F:begin', 'G:end', 'A:-']);
  });

  it('an additive meter says its own grouping: 3+2/8 beams 3 then 2; nonsense beats add nothing', () => {
    expect(beamGroups(2, '3+2', 8)).toEqual([3, 2]);
    expect(beamGroups(2, 'x', 8)).toEqual([]);
    const xml = piece(5, 8, ['C', 'D', 'E', 'F', 'G'].map((s) => note(s, 'eighth', 1)).join('')).replace('<beats>5</beats>', '<beats>3+2</beats>');
    expect(beams(beam(xml))).toEqual(['C:begin', 'D:continue', 'E:end', 'F:begin', 'G:end']);
  });

  it('a chord tone never starts a beam of its own after its head was already beamed', () => {
    const xml = piece(6, 8, note('C', 'eighth', 1).replace('<type>', '<beam number="1">begin</beam><type>') +
      note('D', 'eighth', 1).replace('<type>', '<beam number="1">end</beam><type>') + note('F', 'eighth', 1, '<chord/>') + note('E', 'eighth', 1));
    expect(beams(beam(xml))).toEqual(['C:begin', 'D:end', 'F:-', 'E:-']);
  });

  it('a meter change inside a bar leaves that bar to OSMD', () => {
    const xml = piece(6, 8, note('C', 'eighth', 1) + note('D', 'eighth', 1) + '<attributes><divisions>4</divisions></attributes>' + note('E', 'eighth', 2));
    expect(beam(xml)).toBe(xml);
  });

  it('5/8: 2+3', () => {
    const xml = piece(5, 8, ['C', 'D', 'E', 'F', 'G'].map((s) => note(s, 'eighth', 1)).join(''));
    expect(beams(beam(xml))).toEqual(['C:begin', 'D:end', 'E:begin', 'F:continue', 'G:end']);
  });

  it('a pickup bar groups from its end: four eighths before beat 1 in 6/8 are 1 + 3', () => {
    const xml = piece(6, 8, ['C', 'D', 'E', 'F'].map((s) => note(s, 'eighth', 1)).join(''))
      .replace('<measure number="1">', '<measure number="0" implicit="yes">');
    expect(beams(beam(xml))).toEqual(['C:-', 'D:begin', 'E:continue', 'F:end']);
  });

  it('4/4: a quarter or a rest breaks the run; a lone eighth stays flagged', () => {
    const xml = piece(4, 4, note('C', 'eighth', 1) + note('D', 'eighth', 1) + note('E', 'quarter', 2) +
      note('F', 'eighth', 1) + rest('eighth', 1) + note('G', 'eighth', 1) + note('A', 'eighth', 1));
    expect(beams(beam(xml))).toEqual(['C:begin', 'D:end', 'E:-', 'F:-', 'r:-', 'G:begin', 'A:end']);
  });

  it('a chord shares its beam; pitches and durations are unchanged', () => {
    const xml = piece(6, 8, note('C', 'eighth', 1) + note('E', 'eighth', 1, '<chord/>') + note('D', 'eighth', 1) + note('E', 'eighth', 1));
    const out = beam(xml);
    expect(beams(out)).toEqual(['C:begin', 'E:begin', 'D:continue', 'E:end']);
    const strip = (s: string) => s.replace(/<beam number="1">\w+<\/beam>/g, '').replace(/\s+/g, '');
    expect(strip(out)).toBe(strip(serialize(parse(xml))));
  });

  it('tuplets and existing beams are left alone; nothing to add returns the input', () => {
    const tuplet = '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>';
    const xml = piece(2, 4, ['C', 'D', 'E'].map((s) => note(s, 'eighth', 1, tuplet)).join(''));
    expect(beam(xml)).toBe(xml);
  });

  it('a grace note inside a run neither breaks it nor gets a beam', () => {
    const grace = note('G', 'eighth', 0, '<grace/>').replace('<duration>0</duration>', '');
    const xml = piece(6, 8, note('C', 'eighth', 1) + grace + note('D', 'eighth', 1) + note('E', 'eighth', 1));
    expect(beams(beam(xml))).toEqual(['C:begin', 'G:-', 'D:continue', 'E:end']);
  });

  it('second voice after a <backup> is grouped by its own onsets', () => {
    const v2 = (s: string) => note(s, 'eighth', 1).replace('<voice>1</voice>', '<voice>2</voice>');
    const xml = piece(6, 8, note('C', 'half', 6) + '<backup><duration>6</duration></backup>' +
      ['D', 'E', 'F', 'G', 'A', 'B'].map(v2).join(''));
    expect(beams(beam(xml))).toEqual(['C:-', 'D:begin', 'E:continue', 'F:end', 'G:begin', 'A:continue', 'B:end']);
  });

  const real = `${libraryDir()}o-holy-night.musicxml`;
  it.skipIf(!existsSync(real))('O Holy Night: beams added, every pitch and duration as it was', () => {
    const xml = readFileSync(real, 'utf8');
    const out = beam(xml);
    const facts = (s: string) => Array.from(parse(s).getElementsByTagName('note')).map((n) =>
      ['step', 'alter', 'octave', 'duration', 'type'].map((t) => n.getElementsByTagName(t)[0]?.textContent ?? '').join(','));
    expect((out.match(/<beam /g) ?? []).length).toBeGreaterThan(150);
    expect(facts(out)).toEqual(facts(xml));
  });

  const sorcerer = `${libraryDir()}sorcerers-apprentice.musicxml`;
  it.skipIf(!existsSync(sorcerer))("Sorcerer's Apprentice beams like his paper: 9/8 runs of three, 3/8 eighth-rest-eighth flagged (#6612)", () => {
    const xml = readFileSync(sorcerer, 'utf8');
    const out = parse(beam(xml));
    const bar = (n: number) => Array.from(out.getElementsByTagName('measure')).find((m) => m.getAttribute('number') === String(n))!;
    const eighthBeams = (m: Element) => Array.from(m.getElementsByTagName('note'))
      .filter((n) => n.getElementsByTagName('type')[0]?.textContent === 'eighth' && !n.getElementsByTagName('rest').length)
      .map((n) => n.getElementsByTagName('beam')[0]?.textContent ?? '-');
    expect(eighthBeams(bar(1))).toEqual(['begin', 'continue', 'end']); // left hand C D E, beamed on his page
    expect(eighthBeams(bar(2))).toEqual(['begin', 'continue', 'end']); // right hand C D E
    expect(eighthBeams(bar(5))).toEqual(['-', '-', '-']); // chord, rest, C: flags on his page too
    expect(out.getElementsByTagName('note').length).toBe(parse(xml).getElementsByTagName('note').length);
  });
});
