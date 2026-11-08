import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { setFingering, setHold, type XmlImpl } from '../src/shared/fingering';
import { scoreContentKey } from '../src/shared/scoreContent';
import { parseTrust, verifiedHolds } from '../src/shared/trust';

// #11358: a finger (or hold) edit keeps "Verified by you"; a note, rhythm or layout edit drops it.

const impl: XmlImpl = {
  parse: (s) => new DOMParser().parseFromString(s, 'text/xml') as unknown as Document,
  serialize: (d) => new XMLSerializer().serializeToString(d as never),
};

const note = (step = 'C', extra = '', duration = 4, type = 'quarter') =>
  `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>${duration}</duration>` +
  `<voice>1</voice><type>${type}</type><staff>1</staff>${extra}</note>`;

const score = (body: string, head = '') =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n` +
  `<score-partwise version="4.0">\n  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>\n` +
  `  <part id="P1">\n    <measure number="1">${head}\n      <attributes><divisions>4</divisions></attributes>\n      ${body}\n    </measure>\n` +
  `    <measure number="2">${note('D')}</measure>\n  </part>\n</score-partwise>\n`;

const fingered = (digit: string) => `<notations><technical><fingering>${digit}</fingering></technical></notations>`;
const key = scoreContentKey;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('scoreContentKey leaves out his annotations', () => {
  const plain = score(note('C') + note('E'));

  it('is the same with or without a fingering, whatever the digit', () => {
    expect(key(score(note('C', fingered('3')) + note('E')))).toBe(key(plain));
    expect(key(score(note('C', fingered('1')) + note('E')))).toBe(key(plain));
    expect(key(score(note('C', fingered('1')) + note('E', fingered('5'))))).toBe(key(plain));
  });

  it('is the same with or without a hold mark', () => {
    const hold = '<play><other-play type="miditutor">hold</other-play></play>';
    expect(key(score(note('C', hold) + note('E')))).toBe(key(plain));
  });

  it('ignores formatting: indentation, quotes, attribute order, empty tags, entities, prolog', () => {
    const a = `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Tom's</part-name></score-part></part-list>` +
      `<part id="P1"><measure number="1" width="200"><note><rest/><duration>4</duration></note></measure></part></score-partwise>`;
    const b = `<?xml version='1.0' encoding='utf-8'?>\n<!-- made elsewhere -->\n<score-partwise   version='4.0'>\n` +
      `  <part-list>\n    <score-part id='P1'>\n      <part-name>Tom&apos;s</part-name>\n    </score-part>\n  </part-list>\n` +
      `  <part id="P1">\n    <measure width='200' number="1">\n      <note>\n        <rest></rest>\n        <duration>4</duration>\n` +
      `      </note>\n    </measure>\n  </part>\n</score-partwise>\n`;
    expect(key(b)).toBe(key(a));
  });

  it('is the same when the last finger goes with a wrapper that had attributes', () => {
    const shown = '<notations print-object="yes"><technical placement="above"><fingering>3</fingering></technical></notations>';
    expect(key(score(note('C', shown) + note('E')))).toBe(key(plain));
  });

  it('treats CDATA as the text it holds', () => {
    const title = (t: string) => `<score-partwise><work><work-title>${t}</work-title></work><part id="P1"/></score-partwise>`;
    expect(key(title('A<![CDATA[ & B]]>'))).toBe(key(title('A &amp; B')));
  });

  it('keeps everything else in a notations that also held a fingering', () => {
    const slur = '<notations><slur type="start" number="1"/><technical><fingering>2</fingering></technical></notations>';
    const slurOnly = '<notations><slur number="1" type="start"/></notations>';
    expect(key(score(note('C', slur) + note('E')))).toBe(key(score(note('C', slurOnly) + note('E'))));
    expect(key(score(note('C', slur) + note('E')))).not.toBe(key(plain));
  });
});

describe('scoreContentKey sees the notes, rhythm and layout', () => {
  const plain = score(note('C') + note('E'));

  it('changes with a pitch', () => {
    expect(key(score(note('C') + note('F')))).not.toBe(key(plain));
  });

  it('changes with a duration or note type', () => {
    expect(key(score(note('C', '', 8) + note('E')))).not.toBe(key(plain));
    expect(key(score(note('C', '', 4, 'eighth') + note('E')))).not.toBe(key(plain));
  });

  it('changes with a line break', () => {
    expect(key(score(note('C') + note('E'), '<print new-system="yes"/>'))).not.toBe(key(plain));
  });

  it('changes when a non-finger notation goes', () => {
    expect(key(score(note('C', '<notations><slur type="start"/></notations>') + note('E')))).not.toBe(key(plain));
  });

  it('throws on XML it cannot read', () => {
    expect(() => key('<a><b></a>')).toThrow('not well-formed XML');
    expect(() => key('<a>')).toThrow('not well-formed XML');
    expect(() => key('<a>&bogus;</a>')).toThrow('not well-formed XML');
  });
});

describe('a verified score through his edits (#11358)', () => {
  const reviewed = score(note('C', fingered('2')) + note('E'));
  const entry = parseTrust({
    'p.musicxml': {
      status: 'verified', note: 'Nov 8, all 2 lines', source: 'todd-review',
      score_sha256: sha(reviewed), content_sha256: sha(key(reviewed)),
    },
  })['p.musicxml'];
  // What listPieces does before the Score tab's "Print for binder" gate reads piece.trust.
  const stillVerified = (xml: string) => {
    let content: string | undefined;
    try {
      content = sha(key(xml));
    } catch {
      content = undefined;
    }
    return verifiedHolds(entry, sha(xml), content);
  };
  const target = { measure: 1, staff: 1, onset: 0, midi: 60 };

  it('reads content_sha256 from trust.json', () => {
    expect(entry).toMatchObject({ status: 'verified', sha: sha(reviewed), contentSha: sha(key(reviewed)) });
  });

  it('keeps verified (so print is allowed) after the Score tab changes, adds or removes a finger', () => {
    expect(stillVerified(reviewed)).toBe(true);
    for (const digit of ['4', null] as const) {
      const result = setFingering(reviewed, target, digit, impl);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.xml).not.toBe(reviewed);
      expect(stillVerified(result.xml)).toBe(true);
    }
    const second = setFingering(reviewed, { ...target, onset: 1, midi: 64 }, '3', impl);
    expect(second.ok && stillVerified(second.xml)).toBe(true);
  });

  it('keeps verified after a hold mark', () => {
    const result = setHold(reviewed, target, true, impl);
    expect(result.ok && stillVerified(result.xml)).toBe(true);
  });

  it('drops verified after a note edit, a rhythm edit or a layout edit', () => {
    expect(stillVerified(reviewed.replace('<step>E</step>', '<step>F</step>'))).toBe(false);
    expect(stillVerified(reviewed.replace('<type>quarter</type>', '<type>half</type>'))).toBe(false);
    expect(stillVerified(reviewed.replace('<measure number="2">', '<measure number="2"><print new-system="yes"/>'))).toBe(false);
  });

  it('drops verified for an unreadable file, and an old entry without content_sha256 needs the exact file', () => {
    expect(stillVerified('<score-partwise>')).toBe(false);
    const old = { status: 'verified' as const, note: '', sha: sha(reviewed) };
    expect(verifiedHolds(old, sha(reviewed), sha(key(reviewed)))).toBe(true);
    const edited = setFingering(reviewed, target, '4', impl);
    expect(edited.ok && verifiedHolds(old, sha(edited.xml), sha(key(edited.xml)))).toBe(false);
  });

  // The desk applies his Mac finger taps with set_fingering.py (ElementTree rewrites the
  // whole file): its output must hash the same as the Score tab's.
  it('gives the same key for the desk script\'s rewrite of a finger edit', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'score-content-'));
    const file = path.join(dir, 'p.musicxml');
    fs.writeFileSync(file, reviewed);
    try {
      execFileSync('python', [path.join(__dirname, '..', 'scripts', 'set_fingering.py'), file, '1', '1', '0', '60', '4']);
    } catch (err) {
      // No python here (CI on the Mac build): the ElementTree path is covered on the desk.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    const rewritten = fs.readFileSync(file, 'utf8');
    fs.rmSync(dir, { recursive: true, force: true });
    expect(rewritten).not.toBe(reviewed);
    expect(rewritten).toContain('<fingering>4</fingering>');
    expect(stillVerified(rewritten)).toBe(true);
  });
});
