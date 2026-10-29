// #9988: set or remove one fingering in a MusicXML score. The note is found by measure
// position, staff, onset (quarters from the bar start) and sounding MIDI pitch. An
// ambiguous match is refused, never guessed. scripts/set_fingering.py applies the same
// rule to the desk library copy.

export interface FingerTarget {
  measure: number;
  staff: number;
  onset: number;
  midi: number;
}

export type Digit = '1' | '2' | '3' | '4' | '5';
export type FingerResult = { ok: true; xml: string } | { ok: false; reason: string };

export interface XmlImpl {
  parse(xml: string): Document;
  serialize(doc: Document): string;
}

function name(element: Element): string {
  return element.localName || element.nodeName.split(':').pop() || '';
}

function children(parent: Element, wanted?: string): Element[] {
  const result: Element[] = [];
  for (let i = 0; i < parent.childNodes.length; i += 1) {
    const node = parent.childNodes.item(i);
    if (node && node.nodeType === 1) {
      const element = node as Element;
      if (wanted === undefined || name(element) === wanted) {
        result.push(element);
      }
    }
  }
  return result;
}

function child(parent: Element, wanted: string): Element | undefined {
  return children(parent, wanted)[0];
}

function value(parent: Element, wanted: string, fallback: number): number {
  const element = child(parent, wanted);
  if (!element) {
    return fallback;
  }
  const text = (element.textContent || '').trim();
  const number = Number(text);
  if (text === '' || !Number.isFinite(number)) {
    throw new Error('parse error');
  }
  return number;
}

function create(doc: Document, parent: Element, tag: string): Element {
  return parent.namespaceURI !== null
    ? doc.createElementNS(parent.namespaceURI, tag)
    : doc.createElement(tag);
}

function empty(element: Element): boolean {
  for (let i = 0; i < element.childNodes.length; i += 1) {
    const node = element.childNodes.item(i);
    if (
      node &&
      ((node.nodeType !== 3 && node.nodeType !== 4) ||
        (node.nodeValue || '').trim() !== '')
    ) {
      return false;
    }
  }
  return true;
}

function noteMidi(note: Element): number | null {
  if (child(note, 'rest') || child(note, 'unpitched')) {
    return null;
  }
  const pitch = child(note, 'pitch');
  if (!pitch) {
    return null;
  }
  const offsets: Record<string, number> = {
    C: 0,
    D: 2,
    E: 4,
    F: 5,
    G: 7,
    A: 9,
    B: 11,
  };
  const step = (child(pitch, 'step')?.textContent || '').trim();
  const offset = offsets[step];
  const octave = value(pitch, 'octave', NaN);
  if (offset === undefined || !Number.isInteger(octave)) {
    return null;
  }
  return (octave + 1) * 12 + offset + value(pitch, 'alter', 0);
}

function edit(doc: Document, note: Element, digit: Digit | null): void {
  const notations = children(note, 'notations');

  // Remove fingerings from every technical element.
  for (const notation of notations) {
    for (const technical of children(notation, 'technical')) {
      for (const fingering of children(technical, 'fingering')) {
        technical.removeChild(fingering);
      }
    }
  }

  if (digit === null) {
    for (const notation of notations) {
      for (const technical of children(notation, 'technical')) {
        if (empty(technical)) {
          notation.removeChild(technical);
        }
      }
      if (empty(notation)) {
        note.removeChild(notation);
      }
    }
    return;
  }

  let technical: Element | undefined;
  for (const notation of notations) {
    technical = child(notation, 'technical');
    if (technical) {
      break;
    }
  }

  if (!technical) {
    let notation = notations[0];
    if (!notation) {
      notation = create(doc, note, 'notations');
      const lyric = child(note, 'lyric');
      if (lyric) {
        note.insertBefore(notation, lyric);
      } else {
        note.appendChild(notation);
      }
    }
    technical = create(doc, notation, 'technical');
    notation.appendChild(technical);
  }

  const fingering = create(doc, technical, 'fingering');
  fingering.textContent = digit;
  technical.appendChild(fingering);
}

// #10146: "hold, don't re-strike" on one note (JP: the bar-3 A-flat of Sorcerer's
// Apprentice rings on the pedal). Stored as MusicXML's own playback element, never
// drawn: <play><other-play type="miditutor">hold</other-play></play>.
const HOLD_TYPE = 'miditutor';

function holdMarks(note: Element): Element[] {
  return children(note, 'play').flatMap((play) =>
    children(play, 'other-play').filter(
      (o) => o.getAttribute('type') === HOLD_TYPE && (o.textContent || '').trim() === 'hold',
    ),
  );
}

function editHold(doc: Document, note: Element, on: boolean): void {
  for (const mark of holdMarks(note)) {
    const play = mark.parentNode as Element;
    play.removeChild(mark);
    if (empty(play)) note.removeChild(play);
  }
  if (!on) return;
  let play = child(note, 'play');
  if (!play) {
    play = create(doc, note, 'play');
    const listen = child(note, 'listen');
    if (listen) note.insertBefore(play, listen);
    else note.appendChild(play);
  }
  const mark = create(doc, play, 'other-play');
  mark.setAttribute('type', HOLD_TYPE);
  mark.textContent = 'hold';
  play.appendChild(mark);
}

function parseScore(xml: string, impl?: XmlImpl): { doc: Document; part: Element; impl: XmlImpl } | string {
  const implementation: XmlImpl = impl || {
    parse: source => new globalThis.DOMParser().parseFromString(source, 'text/xml'),
    serialize: doc => new globalThis.XMLSerializer().serializeToString(doc),
  };
  const doc = implementation.parse(xml);
  const root = doc.documentElement;
  if (!root) {
    return 'parse error';
  }
  const elements = doc.getElementsByTagName('*');
  for (let i = 0; i < elements.length; i += 1) {
    const element = elements.item(i);
    if (element && name(element) === 'parsererror') {
      return 'parse error';
    }
  }
  if (name(root) !== 'score-partwise') {
    return 'expected score-partwise';
  }
  const part = child(root, 'part');
  if (!part) {
    return 'no <part>';
  }
  return { doc, part, impl: implementation };
}

/** Every pitched note of the part in bars 1..lastMeasure, with where it sits. */
function walkNotes(part: Element, lastMeasure: number, visit: (note: Element, at: FingerTarget) => void): void {
  const measures = children(part, 'measure');
  let divisions = 1;
  for (let index = 0; index < Math.min(lastMeasure, measures.length); index += 1) {
    let cursor = 0;
    let previousStart = 0;
    for (const element of children(measures[index])) {
      const tag = name(element);
      if (tag === 'attributes') {
        divisions = value(element, 'divisions', divisions);
        if (divisions <= 0) {
          throw new Error('divisions must be positive');
        }
      } else if (tag === 'backup' || tag === 'forward') {
        const duration = value(element, 'duration', 0);
        cursor += tag === 'backup' ? -duration : duration;
      } else if (tag === 'note') {
        const chord = child(element, 'chord') !== undefined;
        const start = chord ? previousStart : cursor;
        previousStart = start;
        if (!chord) {
          cursor += value(element, 'duration', 0);
        }
        const midi = noteMidi(element);
        const staff = value(element, 'staff', 1);
        if (midi !== null && Number.isInteger(staff)) {
          visit(element, { measure: index + 1, staff, onset: start / divisions, midi });
        }
      }
    }
  }
}

/** Edit the one note at `target`; an ambiguous or missing match is refused. */
function editAt(
  xml: string,
  target: FingerTarget,
  change: (doc: Document, note: Element) => void,
  impl?: XmlImpl,
): FingerResult {
  try {
    const parsed = parseScore(xml, impl);
    if (typeof parsed === 'string') {
      return { ok: false, reason: parsed };
    }
    const count = children(parsed.part, 'measure').length;
    if (!Number.isInteger(target.measure) || target.measure < 1 || target.measure > count) {
      return { ok: false, reason: 'measure out of range' };
    }
    const candidates: Element[] = [];
    walkNotes(parsed.part, target.measure, (note, at) => {
      if (
        at.measure === target.measure &&
        at.staff === target.staff &&
        Math.abs(at.onset - target.onset) < 1e-6 &&
        at.midi === target.midi
      ) {
        candidates.push(note);
      }
    });
    if (candidates.length === 0) {
      return { ok: false, reason: 'no such note' };
    }
    if (candidates.length > 1) {
      return { ok: false, reason: `ambiguous: ${candidates.length} notes` };
    }
    change(parsed.doc, candidates[0]);
    return { ok: true, xml: parsed.impl.serialize(parsed.doc) };
  } catch (error: unknown) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'parse error',
    };
  }
}

/** Browser default uses globalThis DOMParser/XMLSerializer. */
export function setFingering(
  xml: string,
  target: FingerTarget,
  digit: Digit | null,
  impl?: XmlImpl,
): FingerResult {
  if (digit !== null && !['1', '2', '3', '4', '5'].includes(digit)) {
    return { ok: false, reason: 'digit must be 1-5 or null' };
  }
  return editAt(xml, target, (doc, note) => edit(doc, note, digit), impl);
}

/** #10146: mark one note "hold, don't re-strike" (on) or remove the mark. */
export function setHold(xml: string, target: FingerTarget, on: boolean, impl?: XmlImpl): FingerResult {
  return editAt(xml, target, (doc, note) => editHold(doc, note, on), impl);
}

/** #10146: every note marked "hold"; [] when the score can't be read. */
export function holdsOf(xml: string, impl?: XmlImpl): FingerTarget[] {
  if (!xml.includes('other-play')) return [];
  try {
    const parsed = parseScore(xml, impl);
    if (typeof parsed === 'string') return [];
    const out: FingerTarget[] = [];
    walkNotes(parsed.part, Infinity, (note, at) => {
      if (holdMarks(note).length) out.push(at);
    });
    return out;
  } catch {
    return [];
  }
}
