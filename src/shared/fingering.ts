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

  try {
    const implementation: XmlImpl = impl || {
      parse: source => new globalThis.DOMParser().parseFromString(source, 'text/xml'),
      serialize: doc => new globalThis.XMLSerializer().serializeToString(doc),
    };
    const doc = implementation.parse(xml);
    const root = doc.documentElement;
    if (!root) {
      return { ok: false, reason: 'parse error' };
    }
    const elements = doc.getElementsByTagName('*');
    for (let i = 0; i < elements.length; i += 1) {
      const element = elements.item(i);
      if (element && name(element) === 'parsererror') {
        return { ok: false, reason: 'parse error' };
      }
    }
    if (name(root) !== 'score-partwise') {
      return { ok: false, reason: 'expected score-partwise' };
    }
    const part = child(root, 'part');
    if (!part) {
      return { ok: false, reason: 'no <part>' };
    }
    const measures = children(part, 'measure');
    if (
      !Number.isInteger(target.measure) ||
      target.measure < 1 ||
      target.measure > measures.length
    ) {
      return { ok: false, reason: 'measure out of range' };
    }

    let divisions = 1;
    const candidates: Element[] = [];
    for (let index = 0; index < target.measure; index += 1) {
      const measure = measures[index];
      if (!measure) {
        return { ok: false, reason: 'measure out of range' };
      }
      let cursor = 0;
      let previousStart = 0;
      for (const element of children(measure)) {
        const tag = name(element);
        if (tag === 'attributes') {
          divisions = value(element, 'divisions', divisions);
          if (divisions <= 0) {
            return { ok: false, reason: 'divisions must be positive' };
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
          const staff = value(element, 'staff', 1);
          if (
            index === target.measure - 1 &&
            Number.isInteger(staff) &&
            staff === target.staff &&
            Math.abs(start / divisions - target.onset) < 1e-6 &&
            noteMidi(element) === target.midi
          ) {
            candidates.push(element);
          }
        }
      }
    }

    if (candidates.length === 0) {
      return { ok: false, reason: 'no such note' };
    }
    if (candidates.length > 1) {
      return { ok: false, reason: `ambiguous: ${candidates.length} notes` };
    }
    const note = candidates[0];
    if (!note) {
      return { ok: false, reason: 'no such note' };
    }
    edit(doc, note, digit);
    return { ok: true, xml: implementation.serialize(doc) };
  } catch (error: unknown) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'parse error',
    };
  }
}
