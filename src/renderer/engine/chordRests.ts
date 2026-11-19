// A rest marked <chord/> (OMR leaves these) crashes OSMD: it sorts a chord's notes by
// pitch and a rest has none, so the whole window went blank (New World, 11/19). A rest
// cannot be part of a chord, and as a chord member it takes no time, so dropping it
// changes nothing that is played or counted. Applied to the XML handed to OSMD only;
// the file on disk is left alone.

const isEl = (n: Node): n is Element => n.nodeType === 1;
const hasChild = (el: Element, name: string) =>
  Array.from(el.childNodes).some((n) => isEl(n) && n.tagName === name);

export function dropChordRests(
  xml: string,
  parse: (xml: string) => Document = (s) => new DOMParser().parseFromString(s, 'application/xml'),
  serialize: (doc: Document) => string = (d) => new XMLSerializer().serializeToString(d),
): string {
  if (!xml.includes('<chord')) return xml;
  const doc = parse(xml);
  if (doc.getElementsByTagName('parsererror').length) return xml;
  const bad = Array.from(doc.getElementsByTagName('note')).filter(
    (n) => hasChild(n, 'chord') && hasChild(n, 'rest'),
  );
  if (!bad.length) return xml;
  for (const n of bad) n.parentNode?.removeChild(n);
  return serialize(doc);
}
