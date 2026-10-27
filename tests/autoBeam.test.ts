import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { addBeams, beamGroup } from '../src/renderer/engine/autoBeam';

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

describe('beamGroup', () => {
  it('three eighths in compound time, a beat otherwise', () => {
    expect(beamGroup(2, 6, 8)).toBe(3);
    expect(beamGroup(2, 12, 8)).toBe(3);
    expect(beamGroup(2, 4, 4)).toBe(2);
    expect(beamGroup(2, 2, 2)).toBe(4);
    expect(beamGroup(2, 5, 8)).toBe(1);
  });
});

describe('addBeams', () => {
  it('6/8: two groups of three eighths', () => {
    const xml = piece(6, 8, ['C', 'D', 'E', 'F', 'G', 'A'].map((s) => note(s, 'eighth', 1)).join(''));
    expect(beams(beam(xml))).toEqual(['C:begin', 'D:continue', 'E:end', 'F:begin', 'G:continue', 'A:end']);
  });

  it('4/4: eighths beam per beat; a quarter or a rest breaks the run; a lone eighth stays flagged', () => {
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

  const real = 'Q:/Personal/piano/library/o-holy-night.musicxml';
  it.skipIf(!existsSync(real))('O Holy Night: beams added, every pitch and duration as it was', () => {
    const xml = readFileSync(real, 'utf8');
    const out = beam(xml);
    const facts = (s: string) => Array.from(parse(s).getElementsByTagName('note')).map((n) =>
      ['step', 'alter', 'octave', 'duration', 'type'].map((t) => n.getElementsByTagName(t)[0]?.textContent ?? '').join(','));
    expect((out.match(/<beam /g) ?? []).length).toBeGreaterThan(150);
    expect(facts(out)).toEqual(facts(xml));
  });
});
