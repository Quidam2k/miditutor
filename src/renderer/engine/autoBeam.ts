// Beams for drawing only (#9764, rules #6612). The OMR'd scores carry no <beam>s, and OSMD's own
// autoBeam splits at every eighth in x/8 time, so 6/8, 9/8 and 3/8 came out as flags.
// This adds <beam> to the XML handed to OSMD, grouped by the time signature (JP's rules,
// docs/beaming-rules.md): a dotted quarter in compound time (3/8 = the whole bar), 5/8 = 2+3,
// 7/8 = 2+2+3, half bars in 4/4 and the whole bar in 2/4 (back to beats when a 16th is in it),
// else one beat. A pickup bar is grouped from its end. Pitches and durations are untouched;
// tuplets, grace notes and anything already beamed are left to OSMD.

const BEAMABLE = new Set(['eighth', '16th', '32nd', '64th']);
const SHORT = new Set(['16th', '32nd', '64th']);

const child = (el: Element, name: string): Element | undefined =>
  Array.from(el.childNodes).find((n): n is Element => n.nodeType === 1 && (n as Element).tagName === name);
const kids = (el: Element, name: string): Element[] =>
  Array.from(el.childNodes).filter((n): n is Element => n.nodeType === 1 && (n as Element).tagName === name);
const num = (el: Element | undefined, name: string): number | undefined => {
  const text = el && child(el, name)?.textContent;
  return text ? Number(text) : undefined;
};

/** The beam groups of one full bar, in divisions, first to last. `short`: a 16th or shorter is in it. */
export function beamGroups(divisions: number, beats: number | string, beatType: number, short = false): number[] {
  const beat = (divisions * 4) / beatType;
  if (!(beat > 0)) return [];
  // An additive meter ("3+2", "2+2+3") says its own grouping.
  if (typeof beats === 'string' && beats.includes('+')) {
    const parts = beats.split('+').map(Number);
    return parts.every((n) => n > 0) ? parts.map((n) => n * beat) : [];
  }
  beats = Number(beats);
  if (!(beats > 0)) return [];
  if (beatType === 8 && beats % 3 === 0) return Array(beats / 3).fill(beat * 3);
  if (beatType === 8 && beats >= 2) {
    const odd = beats % 2 === 1;
    return [...Array(odd ? (beats - 3) / 2 : beats / 2).fill(beat * 2), ...(odd ? [beat * 3] : [])];
  }
  if (!short && beatType === 4 && (beats === 2 || beats === 4)) return Array(beats / 2).fill(beat * 2);
  return Array(Math.max(1, beats)).fill(beat);
}

/** Which group a position in the bar falls in; past the bar it keeps counting in last-group steps. */
function groupOf(at: number, groups: number[]): number {
  let end = 0;
  for (let i = 0; i < groups.length; i++) {
    end += groups[i];
    if (at < end - groups[i] * 1e-9) return i;
  }
  return groups.length + Math.floor((at - end) / (groups[groups.length - 1] || 1));
}

/** How far a measure's notes run, in divisions (for a pickup bar). */
function measureLength(measure: Element): number {
  let pos = 0;
  let most = 0;
  for (const el of Array.from(measure.childNodes).filter((n): n is Element => n.nodeType === 1)) {
    if (el.tagName === 'backup') pos -= num(el, 'duration') ?? 0;
    else if (el.tagName === 'forward') pos += num(el, 'duration') ?? 0;
    else if (el.tagName === 'note' && !child(el, 'grace') && !child(el, 'chord')) pos += num(el, 'duration') ?? 0;
    most = Math.max(most, pos);
  }
  return most;
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
    let time: [string, number] = ['4', 4];
    for (const measure of kids(part, 'measure')) {
      let seenNote = false;
      let midBar = false;
      for (const el of Array.from(measure.childNodes).filter((n): n is Element => n.nodeType === 1)) {
        if (el.tagName === 'note') seenNote = true;
        if (el.tagName !== 'attributes') continue;
        const t = child(el, 'time');
        if (seenNote && (child(el, 'divisions') || t)) midBar = true;
        divisions = num(el, 'divisions') ?? divisions;
        if (t) time = [child(t, 'beats')?.textContent?.trim() || time[0], num(t, 'beat-type') ?? time[1]];
      }
      // A meter or divisions change inside the bar: leave that bar to OSMD rather than group it wrong.
      if (midBar) continue;
      const wide = beamGroups(divisions, time[0], time[1]);
      if (!wide.length) continue;
      const narrow = beamGroups(divisions, time[0], time[1], true);
      // A pickup bar is the end of a full bar, so its groups count back from the barline.
      const bar = wide.reduce((a, b) => a + b, 0);
      const length = measureLength(measure);
      const offset = measure.getAttribute('implicit') === 'yes' && length < bar ? bar - length : 0;
      // Runs of beamable notes per voice: [onset, end, notes at that onset].
      type Step = { onset: number; end: number; short: boolean; notes: Element[] };
      const runs = new Map<string, Step[]>();
      const emit = (steps: Step[]) => {
        if (steps.length < 2) return;
        steps.forEach((step, i) => {
          const value = i === 0 ? 'begin' : i === steps.length - 1 ? 'end' : 'continue';
          for (const note of step.notes) {
            const beam = doc.createElement('beam');
            beam.setAttribute('number', '1');
            beam.appendChild(doc.createTextNode(value));
            note.insertBefore(beam, child(note, 'notations') ?? child(note, 'lyric') ?? child(note, 'play') ?? child(note, 'listen') ?? null);
            added++;
          }
        });
      };
      const close = (key: string) => {
        const run = runs.get(key) ?? [];
        if (run.some((step) => step.short)) {
          // 16ths beam by the beat, so a half-bar run that holds one splits back into beats.
          let piece: Step[] = [];
          let at = -1;
          for (const step of run) {
            const g = groupOf(step.onset + offset, narrow);
            if (g !== at) {
              emit(piece);
              piece = [];
              at = g;
            }
            piece.push(step);
          }
          emit(piece);
        } else emit(run);
        runs.set(key, []);
      };
      let pos = 0;
      let last = 0;
      for (const el of Array.from(measure.childNodes).filter((n): n is Element => n.nodeType === 1)) {
        const tag = el.tagName;
        if (tag === 'backup') pos -= num(el, 'duration') ?? 0;
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
          const type = child(el, 'type')?.textContent ?? '';
          const beamable = BEAMABLE.has(type) && !child(el, 'rest') &&
            !child(el, 'time-modification') && !child(el, 'beam');
          const prev = run[run.length - 1];
          if (chord) {
            // A chord tone rides on its head's step; it never starts or breaks a run.
            if (beamable && prev && prev.onset === onset && !prev.notes.includes(el)) {
              prev.notes.push(el);
              prev.short ||= SHORT.has(type);
            }
          } else if (!beamable) {
            close(key);
          } else {
            if (prev && (prev.end !== onset || groupOf(prev.onset + offset, wide) !== groupOf(onset + offset, wide))) close(key);
            runs.get(key)!.push({ onset, end: onset + dur, short: SHORT.has(type), notes: [el] });
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
