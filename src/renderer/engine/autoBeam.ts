// Beams for drawing only (#9764). The OMR'd scores carry no <beam>s, and OSMD's own
// autoBeam splits at every eighth in x/8 time, so 6/8 and 12/8 came out as flags.
// This adds <beam> to the XML handed to OSMD, grouped by the time signature: a
// dotted quarter in compound time, else one beat. Pitches and durations are untouched;
// tuplets, grace notes and anything already beamed are left to OSMD.

const BEAMABLE = new Set(['eighth', '16th', '32nd', '64th']);

const child = (el: Element, name: string): Element | undefined =>
  Array.from(el.childNodes).find((n): n is Element => n.nodeType === 1 && (n as Element).tagName === name);
const kids = (el: Element, name: string): Element[] =>
  Array.from(el.childNodes).filter((n): n is Element => n.nodeType === 1 && (n as Element).tagName === name);
const num = (el: Element | undefined, name: string): number | undefined => {
  const text = el && child(el, name)?.textContent;
  return text ? Number(text) : undefined;
};

/** Length of one beam group in divisions: three eighths in 6/8, 9/8, 12/8 (and 3/8), else a beat. */
export function beamGroup(divisions: number, beats: number, beatType: number): number {
  const compound = beatType === 8 && beats % 3 === 0;
  return compound ? (divisions * 3) / 2 : (divisions * 4) / beatType;
}

export function addBeams(
  xml: string,
  parse: (xml: string) => Document = (s) => new DOMParser().parseFromString(s, 'application/xml'),
  serialize: (doc: Document) => string = (d) => new XMLSerializer().serializeToString(d),
): string {
  const doc = parse(xml);
  if (doc.getElementsByTagName('parsererror').length) return xml;
  let added = 0;
  for (const part of Array.from(doc.getElementsByTagName('part'))) {
    let divisions = 1;
    let group = 1;
    let time: [number, number] = [4, 4];
    for (const measure of kids(part, 'measure')) {
      // Runs of beamable notes per voice: [onset, end, notes at that onset].
      const runs = new Map<string, { onset: number; end: number; notes: Element[] }[]>();
      const close = (key: string) => {
        const run = runs.get(key) ?? [];
        if (run.length >= 2) {
          run.forEach((step, i) => {
            const value = i === 0 ? 'begin' : i === run.length - 1 ? 'end' : 'continue';
            for (const note of step.notes) {
              const beam = doc.createElement('beam');
              beam.setAttribute('number', '1');
              beam.appendChild(doc.createTextNode(value));
              note.insertBefore(beam, child(note, 'notations') ?? child(note, 'lyric') ?? null);
              added++;
            }
          });
        }
        runs.set(key, []);
      };
      let pos = 0;
      let last = 0;
      for (const el of Array.from(measure.childNodes).filter((n): n is Element => n.nodeType === 1)) {
        const tag = el.tagName;
        if (tag === 'attributes') {
          divisions = num(el, 'divisions') ?? divisions;
          const t = child(el, 'time');
          if (t) time = [num(t, 'beats') ?? time[0], num(t, 'beat-type') ?? time[1]];
          group = beamGroup(divisions, time[0], time[1]);
        } else if (tag === 'backup') pos -= num(el, 'duration') ?? 0;
        else if (tag === 'forward') pos += num(el, 'duration') ?? 0;
        else if (tag === 'note') {
          // A grace note takes no time and doesn't break the run around it; OSMD draws it on its own.
          if (child(el, 'grace')) continue;
          const chord = !!child(el, 'chord');
          const onset = chord ? last : pos;
          const dur = num(el, 'duration') ?? 0;
          const key = `${num(el, 'staff') ?? 1}/${child(el, 'voice')?.textContent ?? '1'}`;
          const run = runs.get(key) ?? [];
          runs.set(key, run);
          const beamable = BEAMABLE.has(child(el, 'type')?.textContent ?? '') && !child(el, 'rest') &&
            !child(el, 'time-modification') && !child(el, 'beam');
          const prev = run[run.length - 1];
          if (chord && prev && prev.onset === onset) {
            if (beamable) prev.notes.push(el);
          } else if (!beamable) {
            close(key);
          } else {
            if (prev && (prev.end !== onset || Math.floor(prev.onset / group) !== Math.floor(onset / group))) close(key);
            runs.get(key)!.push({ onset, end: onset + dur, notes: [el] });
          }
          if (!chord) {
            last = pos;
            pos += dur;
          }
        }
      }
      for (const key of runs.keys()) close(key);
    }
  }
  return added ? serialize(doc) : xml;
}
