// #11358: what "Verified by you" vouches for. His review checks the notes, rhythm and
// line/page layout against his paper; fingers (and the "hold" mark) are his own
// annotations, which he changes often, so editing them must not undo it. The file is
// rewritten by two serializers (the Score tab's XMLSerializer, set_fingering.py's
// ElementTree), so bytes can't be compared: this is the score as a canonical token list,
// formatting ignored, with those annotations removed. The caller hashes it.

type XmlElement = { name: string; attributes: [string, string][]; children: (XmlElement | string)[] };

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const NAME = '[A-Za-z_:][A-Za-z0-9_.:-]*';
const WS = '[ \\t\\r\\n]';
// Sticky: each matches at lastIndex only, so the scan never copies the rest of the file.
const OPEN = new RegExp(`<(${NAME})((?:${WS}+${NAME}${WS}*=${WS}*(?:"[^"<]*"|'[^'<]*'))*)${WS}*(/?)>`, 'y');
const CLOSE = new RegExp(`</(${NAME})${WS}*>`, 'y');
const ATTRIBUTE = new RegExp(`(${NAME})${WS}*=${WS}*(["'])(.*?)\\2`, 'gs');
// Wrappers that mean nothing once the annotations inside them are gone.
const WRAPPERS = new Set(['technical', 'notations', 'play']);

const fail = (): never => {
  throw new Error('not well-formed XML');
};

const decode = (value: string): string =>
  value.replace(/&([^;&]*);|&/g, (_, entity: string | undefined) => {
    if (entity !== undefined && Object.prototype.hasOwnProperty.call(ENTITIES, entity)) return ENTITIES[entity];
    if (entity === undefined || !/^#(?:[0-9]+|x[0-9a-fA-F]+)$/.test(entity)) return fail();
    const n = entity.startsWith('#x') ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : fail();
  });

const isAnnotation = (node: XmlElement) =>
  node.name === 'fingering' ||
  (node.name === 'other-play' && node.attributes.some(([k, v]) => k === 'type' && v === 'miditutor'));

/** The score's content without his fingers or hold marks; throws on XML it can't read. */
export function scoreContentKey(xml: string): string {
  xml = xml.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const root: XmlElement = { name: '', attributes: [], children: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  let at = 0;
  // Text and CDATA run together, as a serializer may write either.
  const addText = (value: string) => {
    const children = top().children;
    const last = children.length - 1;
    if (typeof children[last] === 'string') children[last] += value;
    else children.push(value);
  };
  const skipTo = (marker: string, from: number) => {
    const end = xml.indexOf(marker, from);
    if (end < 0) fail();
    return end + marker.length;
  };

  while (at < xml.length) {
    if (xml[at] !== '<') {
      const next = xml.indexOf('<', at);
      const end = next < 0 ? xml.length : next;
      const text = xml.slice(at, end);
      if (stack.length === 1) {
        if (text.trim()) fail();
      } else addText(decode(text));
      at = end;
    } else if (xml.startsWith('<!--', at)) {
      at = skipTo('-->', at + 4);
    } else if (xml.startsWith('<?', at)) {
      at = skipTo('?>', at + 2);
    } else if (xml.startsWith('<![CDATA[', at)) {
      if (stack.length === 1) fail();
      const end = skipTo(']]>', at + 9);
      addText(xml.slice(at + 9, end - 3));
      at = end;
    } else if (xml.startsWith('<!DOCTYPE', at)) {
      if (stack.length !== 1 || root.children.length) fail();
      // Its internal subset ([...]) may hold '>' and quoted strings.
      let depth = 0;
      let quote = '';
      for (at += 9; ; at++) {
        if (at >= xml.length) fail();
        const c = xml[at];
        if (quote) { if (c === quote) quote = ''; }
        else if (c === '"' || c === "'") quote = c;
        else if (c === '[') depth++;
        else if (c === ']') depth--;
        else if (c === '>' && depth === 0) { at++; break; }
      }
    } else {
      CLOSE.lastIndex = at;
      const close = CLOSE.exec(xml);
      if (close) {
        if (stack.length === 1 || top().name !== close[1]) fail();
        stack.pop();
        at = CLOSE.lastIndex;
        continue;
      }
      OPEN.lastIndex = at;
      const open = OPEN.exec(xml) ?? fail();
      const attributes: [string, string][] = [];
      for (const a of open[2].matchAll(ATTRIBUTE)) {
        if (attributes.some(([key]) => key === a[1])) fail();
        attributes.push([a[1], decode(a[3].replace(/[\t\n\r]/g, ' '))]);
      }
      attributes.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      const element: XmlElement = { name: open[1], attributes, children: [] };
      top().children.push(element);
      if (!open[3]) stack.push(element);
      at = OPEN.lastIndex;
    }
  }
  if (stack.length !== 1 || root.children.length !== 1 || typeof root.children[0] === 'string') fail();

  const serialize = (node: XmlElement): string[] => {
    if (isAnnotation(node)) return [];
    const content = node.children.flatMap((child) =>
      typeof child === 'string'
        ? (child.trim() ? [`text:${JSON.stringify(child.trim())}`] : [])
        : serialize(child));
    // Even with attributes (print-object="yes"): the editors drop it with its last finger.
    if (!content.length && WRAPPERS.has(node.name)) return [];
    const attrs = node.attributes.map(([k, v]) => ` ${k}=${JSON.stringify(v)}`).join('');
    return [`<${node.name}${attrs}>`, ...content, `</${node.name}>`];
  };
  return serialize(root.children[0] as XmlElement).join('\n');
}
