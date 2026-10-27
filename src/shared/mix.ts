// "My mix" (#9627): per section, bars from the Easy or the Harder version of one piece,
// spliced into one score. The mix is always in the Easy key: Harder bars are transposed
// into it and respelled, and at every change of source the bar restates the source's
// divisions, time, staves and clefs so each run draws as its own file would.
// Pure and DOM-based; parse/serialize are injectable (tests use @xmldom/xmldom).

export interface MixSection {
  /** Inclusive measure numbers in the Easy / Harder file. */
  easy: [number, number];
  harder: [number, number];
  cost?: number;
}
export type MixChoice = 'easy' | 'harder';

// MusicXML child order inside <attributes>
const ATTR_ORDER = ['footnote', 'level', 'divisions', 'key', 'time', 'staves', 'part-symbol', 'instruments',
  'clef', 'staff-details', 'transpose', 'directive', 'measure-style'];
const STEPS = 'CDEFGAB';
const STEP_PC = [0, 2, 4, 5, 7, 9, 11];

const elements = (el: Node): Element[] => Array.from(el.childNodes).filter((n): n is Element => n.nodeType === 1);
const kids = (el: Node, name: string): Element[] => elements(el).filter((c) => c.tagName === name);
const child = (el: Node, name: string): Element | undefined => kids(el, name)[0];
const text = (el: Element | undefined, name: string): string | undefined => (el ? child(el, name)?.textContent?.trim() : undefined);
const remove = (el: Element) => el.parentNode?.removeChild(el);

function setText(doc: Document, el: Element, value: string) {
  while (el.firstChild) el.removeChild(el.firstChild);
  el.appendChild(doc.createTextNode(value));
}

function make(doc: Document, name: string, value?: string): Element {
  const el = doc.createElement(name);
  if (value !== undefined) el.appendChild(doc.createTextNode(value));
  return el;
}

function onlyPart(doc: Document, label: string): Element {
  const parts = doc.documentElement ? kids(doc.documentElement, 'part') : [];
  if (doc.getElementsByTagName('parsererror').length || doc.documentElement?.tagName !== 'score-partwise') {
    throw new Error(`${label} score does not parse`);
  }
  if (parts.length !== 1) throw new Error(`${label} score has ${parts.length} parts; only single-part scores can be mixed`);
  return parts[0];
}

const barNumber = (m: Element): number => {
  const n = m.getAttribute('number');
  return n !== null && /^-?\d+$/.test(n) ? Number(n) : NaN;
};

/** Source measures whose number is in [lo, hi], in document order; every integer in the range must exist. */
function barsIn(measures: Element[], [lo, hi]: [number, number], label: string): Element[] {
  const found = measures.filter((m) => barNumber(m) >= lo && barNumber(m) <= hi);
  for (let n = lo; n <= hi; n++) {
    if (!found.some((m) => barNumber(m) === n)) throw new Error(`${label} bar ${n} is missing`);
  }
  return found;
}

/** Attributes elements before the first note, backup or forward: the ones that apply from the bar's start. */
function leadingAttributes(measure: Element): Element[] {
  const out: Element[] = [];
  for (const el of elements(measure)) {
    if (el.tagName === 'attributes') out.push(el);
    else if (el.tagName === 'note' || el.tagName === 'backup' || el.tagName === 'forward') break;
  }
  return out;
}

const attrId = (el: Element): string => (el.tagName === 'clef' || el.tagName === 'staff-details'
  ? `${el.tagName}:${el.getAttribute('number') ?? '1'}` : el.tagName);

/** What applies at the start of measures[index]: the latest of every attribute element up to that bar. */
function effectiveAttributes(measures: Element[], index: number): Map<string, Element> {
  const map = new Map<string, Element>();
  measures.slice(0, index + 1).forEach((m, i) => {
    const groups = i === index ? leadingAttributes(m) : kids(m, 'attributes');
    for (const a of groups) for (const el of elements(a)) map.set(attrId(el), el);
  });
  return map;
}

const rank = (el: Element) => {
  const i = ATTR_ORDER.indexOf(el.tagName);
  return i < 0 ? ATTR_ORDER.length : i;
};

function keyElement(doc: Document, fifths: number, mode: string | undefined): Element {
  const key = make(doc, 'key');
  key.appendChild(make(doc, 'fifths', String(fifths)));
  if (mode) key.appendChild(make(doc, 'mode', mode));
  return key;
}

/** Put the full effective attributes into the bar's first <attributes> (new one if none); returns it. */
function restateAttributes(doc: Document, measure: Element, effective: Map<string, Element>, key: Element): Element {
  const lead = leadingAttributes(measure);
  const target = lead[0] ?? make(doc, 'attributes');
  for (const extra of lead.slice(1)) remove(extra);
  for (const el of elements(target)) remove(el);
  const items = [...effective.entries()].map(([id, el]) => (id === 'key' ? key : (doc.importNode(el, true) as Element)));
  if (!effective.has('key')) items.push(key);
  items.sort((a, b) => rank(a) - rank(b) || Number(a.getAttribute('number') ?? 0) - Number(b.getAttribute('number') ?? 0));
  for (const el of items) target.appendChild(el);
  if (!target.parentNode) {
    let before: Node | null = null;
    for (const el of elements(measure)) {
      if (el.tagName === 'print' || (el.tagName === 'barline' && el.getAttribute('location') === 'left')) continue;
      before = el;
      break;
    }
    measure.insertBefore(target, before);
  }
  return target;
}

/** Letter-and-octave shift for transposing the harder key's tonic letter onto the easy key's, signed like semis. */
function letterShift(harderFifths: number, easyFifths: number, semis: number): number {
  const tonic = (f: number) => (((f * 4) % 7) + 7) % 7;
  const s = (((tonic(easyFifths) - tonic(harderFifths)) % 7) + 7) % 7;
  return semis < 0 && s > 0 ? s - 7 : s;
}

function transposePitch(doc: Document, pitch: Element, semis: number, shift: number) {
  const stepEl = child(pitch, 'step');
  const octEl = child(pitch, 'octave');
  if (!stepEl || !octEl) return;
  const idx = STEPS.indexOf(stepEl.textContent!.trim());
  const octave = Number(octEl.textContent);
  const alter = Number(text(pitch, 'alter') ?? 0);
  const target = 12 * (octave + 1) + STEP_PC[idx] + alter + semis;
  const raw = idx + shift;
  let newIdx = ((raw % 7) + 7) % 7;
  let newOct = octave + Math.floor(raw / 7);
  let newAlter = target - (12 * (newOct + 1) + STEP_PC[newIdx]);
  if (Math.abs(newAlter) > 2) {
    // Nearest natural; sharps going up, flats going down.
    let best = Infinity;
    for (let o = Math.floor(target / 12) - 2; o <= Math.floor(target / 12); o++) {
      for (let i = 0; i < 7; i++) {
        const natural = 12 * (o + 1) + STEP_PC[i];
        const d = Math.abs(target - natural);
        if (d < best || (d === best && semis < 0)) {
          best = d;
          newIdx = i;
          newOct = o;
        }
      }
    }
    newAlter = target - (12 * (newOct + 1) + STEP_PC[newIdx]);
  }
  setText(doc, stepEl, STEPS[newIdx]);
  setText(doc, octEl, String(newOct));
  const old = child(pitch, 'alter');
  if (newAlter === 0) {
    if (old) remove(old);
  } else if (old) setText(doc, old, String(newAlter));
  else pitch.insertBefore(make(doc, 'alter', String(newAlter)), octEl);
}

export function spliceMix(
  easyXml: string,
  harderXml: string,
  sections: MixSection[],
  choice: MixChoice[],
  semis: number,
  title: string,
  parse: (xml: string) => Document = (s) => new DOMParser().parseFromString(s, 'application/xml'),
  serialize: (doc: Document) => string = (d) => new XMLSerializer().serializeToString(d),
): string {
  if (choice.length !== sections.length) throw new Error(`${choice.length} choices for ${sections.length} sections`);
  const doc = parse(easyXml);
  const harderDoc = parse(harderXml);
  const easyPart = onlyPart(doc, 'Easy');
  const harderPart = onlyPart(harderDoc, 'Harder');
  const sources = { easy: kids(easyPart, 'measure'), harder: kids(harderPart, 'measure') };

  const easyKey = doc.getElementsByTagName('key')[0];
  const easyFifths = Number(text(easyKey, 'fifths') ?? 0);
  const easyMode = text(easyKey, 'mode');
  const harderFifths = Number(text(harderDoc.getElementsByTagName('key')[0], 'fifths') ?? 0);
  const shift = letterShift(harderFifths, easyFifths, semis);

  const mixed: Element[] = [];
  let previous: MixChoice | undefined;
  sections.forEach((section, k) => {
    const from = choice[k];
    const measures = sources[from];
    const picked = barsIn(measures, section[from], from === 'easy' ? 'Easy' : 'Harder');
    picked.forEach((original, n) => {
      const measure = doc.importNode(original, true) as Element;
      if (from === 'harder') {
        for (const el of [...kids(measure, 'harmony'), ...kids(measure, 'print')]) remove(el);
        for (const key of Array.from(measure.getElementsByTagName('key'))) {
          const fifths = child(key, 'fifths');
          if (fifths) setText(doc, fifths, String(easyFifths));
        }
        if (semis !== 0) {
          for (const note of Array.from(measure.getElementsByTagName('note'))) {
            const pitch = child(note, 'pitch');
            if (!pitch) continue;
            transposePitch(doc, pitch, semis, shift);
            for (const accidental of kids(note, 'accidental')) remove(accidental);
          }
        }
      }
      if (n === 0 && previous !== from) {
        const effective = effectiveAttributes(measures, measures.indexOf(original));
        const attributes = restateAttributes(doc, measure, effective, keyElement(doc, easyFifths, easyMode));
        if (from === 'harder') {
          const direction = doc.createElement('direction');
          direction.setAttribute('placement', 'above');
          const type = make(doc, 'direction-type');
          type.appendChild(make(doc, 'words', 'Harder: no fingering'));
          direction.appendChild(type);
          direction.appendChild(make(doc, 'staff', '1'));
          measure.insertBefore(direction, attributes.nextSibling);
        }
      }
      mixed.push(measure);
    });
    previous = from;
  });

  for (const m of sources.easy) remove(m);
  mixed.forEach((m, i) => {
    m.setAttribute('number', String(i + 1));
    if (i > 0) m.removeAttribute('implicit');
    easyPart.appendChild(m);
  });

  setTitle(doc, `${title} (My mix)`);
  return serialize(doc);
}

function setTitle(doc: Document, value: string) {
  const root = doc.documentElement;
  const movement = child(root, 'movement-title');
  if (movement) return setText(doc, movement, value);
  let work = child(root, 'work');
  if (!work) {
    work = doc.createElement('work');
    root.insertBefore(work, root.firstChild);
  }
  let workTitle = child(work, 'work-title');
  if (!workTitle) {
    workTitle = doc.createElement('work-title');
    const number = child(work, 'work-number');
    work.insertBefore(workTitle, number ? number.nextSibling : work.firstChild);
  }
  setText(doc, workTitle, value);
}
