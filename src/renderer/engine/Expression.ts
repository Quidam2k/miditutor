// #9569: expression telemetry. The page's dynamics, hairpins, rit./accel. and fermatas
// against how he played them (velocity relative to his own median, tempo against the
// bars before). Report-only: nothing here gates the ScoreFollower or marks a note wrong.

import type { ScoreStep } from './ScoreFollower';

export type MarkSource = 'score' | 'omr' | 'page-read';
export type DynamicLevel = 'ppp' | 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff' | 'fff';
export const LEVELS: DynamicLevel[] = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'];

export interface ExpressionMark {
  kind: 'dynamic' | 'wedge' | 'tempo' | 'fermata';
  value: string;
  bar: number;
  beat: number;
  endBar?: number;
  endBeat?: number;
  durationBeats?: number;
  source: MarkSource;
  confidence?: number;
  text?: string;
}

export interface Hit { step: number; note: number; velocity: number; timeMs: number }

export interface ExpressionFinding {
  kind: ExpressionMark['kind'];
  mark: ExpressionMark;
  expected: string;
  played: string;
  ok: boolean | null;
  detail: Record<string, number>;
  text: string;
}

const EPSILON = 1e-6;
const VELOCITY_PER_LEVEL = 10;
const DYNAMICS = new Set<string>([...LEVELS, 'sf', 'sfz', 'sffz', 'fz', 'rfz', 'fp', 'sfp']);
const levelIndex = (value: string) => LEVELS.indexOf(value as DynamicLevel);
const tag = (el: Element) => el.localName || el.nodeName;

function kids(node: Node, name?: string): Element[] {
  const result: Element[] = [];
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i] as Element;
    if (child.nodeType === 1 && (!name || tag(child) === name)) result.push(child);
  }
  return result;
}

function number(value: string | null | undefined, fallback = 0): number {
  const n = value == null || value.trim() === '' ? NaN : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length ? (sorted[mid] + sorted[Math.floor((sorted.length - 1) / 2)]) / 2 : 0;
}

export function parseExpression(
  xml: string,
  parse: (xml: string) => Document = (s) => new DOMParser().parseFromString(s, 'application/xml')
): ExpressionMark[] {
  try {
    const doc = parse(xml);
    const root = kids(doc)[0];
    if (!root || tag(root) !== 'score-partwise' || doc.getElementsByTagName('parsererror').length) return [];
    // An OMR scan's marks are its reading of the page, not the engraver's.
    const software = Array.from(doc.getElementsByTagName('software'));
    const source: MarkSource = software.some((el) => /homr|audiveris/i.test(el.textContent || '')) ? 'omr' : 'score';
    const result: ExpressionMark[] = [];
    const timelines: Array<{ marks: ExpressionMark[]; ends: number[]; words: Set<ExpressionMark> }> = [];
    for (const part of kids(root, 'part')) {
      let divisions = 1, measureStart = 0;
      const ends: number[] = [], marks: ExpressionMark[] = [];
      const wedges = new Map<string, ExpressionMark>();
      const dashes = new Map<string, ExpressionMark[]>();
      const wordSpans = new Set<ExpressionMark>(), bound = new Set<ExpressionMark>();
      let pending: ExpressionMark[] = [];
      const measures = kids(part, 'measure');
      for (let mi = 0; mi < measures.length; mi++) {
        let position = 0, max = 0, previousStart = 0;
        for (const el of kids(measures[mi])) {
          const name = tag(el);
          const duration = number(kids(el, 'duration')[0]?.textContent) / divisions;
          if (name === 'attributes') {
            divisions = Math.max(EPSILON, number(kids(el, 'divisions')[0]?.textContent, divisions));
          } else if (name === 'backup' || name === 'forward') {
            position += name === 'backup' ? -duration : duration;
          } else if (name === 'note') {
            const chord = kids(el, 'chord').length > 0;
            const start = chord ? previousStart : position;
            if (!chord) { previousStart = start; position += duration; }
            if (!kids(el, 'rest').length && kids(el, 'notations').some((n) => kids(n, 'fermata').length)) {
              marks.push({ kind: 'fermata', value: 'fermata', bar: mi + 1,
                beat: measureStart + start, durationBeats: duration, source });
              pending = [];
            }
          } else if (name === 'direction') {
            const beat = measureStart + position + number(kids(el, 'offset')[0]?.textContent) / divisions;
            const page = /^pageread-(\d{1,3})-/.exec(el.getAttribute('id') || '');
            const base = { bar: mi + 1, beat, source: page ? 'page-read' as const : source,
              ...(page ? { confidence: Math.min(1, Number(page[1]) / 100) } : {}) };
            const before = marks.length, words: ExpressionMark[] = [], dash: Element[] = [];
            for (const type of kids(el, 'direction-type')) {
              for (const item of kids(type)) {
                const kind = tag(item), action = item.getAttribute('type');
                const id = item.getAttribute('number') || '1';
                if (kind === 'dynamics') {
                  for (const dynamic of kids(item)) {
                    if (DYNAMICS.has(tag(dynamic))) marks.push({ ...base, kind: 'dynamic', value: tag(dynamic) });
                  }
                } else if (kind === 'wedge') {
                  if (action === 'stop') {
                    const open = wedges.get(id);
                    if (open) { open.endBeat = beat; wedges.delete(id); }
                  } else if (action === 'crescendo' || action === 'diminuendo') {
                    const mark: ExpressionMark = { ...base, kind: 'wedge', value: action === 'crescendo' ? 'cresc' : 'dim' };
                    marks.push(mark); wedges.set(id, mark);
                  }
                } else if (kind === 'words') {
                  const text = item.textContent || '';
                  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ');
                  const value = /\ba tempo\b|\btempo (i|1|primo)\b/.test(normalized) ? 'a tempo'
                    : /\b(rit|ritard|ritardando|ritenuto|riten|rall|rallentando)\b/.test(normalized) ? 'rit'
                    : /\b(accel|accelerando|stringendo)\b/.test(normalized) ? 'accel'
                    : /\b(cresc|crescendo)\b/.test(normalized) ? 'cresc'
                    : /\b(dim|dimin|diminuendo|decresc|decrescendo)\b/.test(normalized) ? 'dim' : '';
                  if (value) {
                    const mark: ExpressionMark = { ...base, kind: value === 'cresc' || value === 'dim' ? 'wedge' : 'tempo', value, text };
                    marks.push(mark);
                    if (value !== 'a tempo') { words.push(mark); wordSpans.add(mark); }
                  }
                } else if (kind === 'dashes') dash.push(item);
              }
            }
            const candidates = words.length ? words : marks.length === before ? pending : [];
            for (const item of dash) {
              const id = item.getAttribute('number') || '1';
              if (item.getAttribute('type') === 'stop') {
                for (const mark of dashes.get(id) || []) mark.endBeat = beat;
                dashes.delete(id);
              } else if (item.getAttribute('type') === 'start') {
                const eligible = candidates.filter((m) => !bound.has(m));
                if (eligible.length) { dashes.set(id, eligible); eligible.forEach((m) => bound.add(m)); }
              }
            }
            pending = (marks.length > before ? words : pending).filter((m) => !bound.has(m));
          }
          // Quarter-beat positions remain meaningful when divisions changes inside a bar.
          max = Math.max(max, position);
        }
        measureStart += max;
        ends.push(measureStart);
      }
      result.push(...marks);
      timelines.push({ marks, ends, words: wordSpans });
    }
    const pieceEnd = Math.max(0, ...timelines.map((t) => t.ends[t.ends.length - 1] ?? 0));
    for (const { marks, ends, words: wordSpans } of timelines) {
      for (const mark of marks) {
        if (mark.kind !== 'wedge' && !(mark.kind === 'tempo' && mark.value !== 'a tempo')) continue;
        const words = wordSpans.has(mark);
        const bars = mark.kind === 'tempo' ? 4 : 2;
        let end = mark.endBeat ?? ends[Math.min(ends.length - 1, mark.bar + (words ? bars : 2) - 2)];
        if (words && mark.endBeat === undefined) {
          for (const next of result) {
            if (next.beat > mark.beat && (mark.kind === 'tempo' ? next.kind === 'tempo'
              : next.kind === 'dynamic' && levelIndex(next.value) >= 0)) end = Math.min(end, next.beat);
          }
        }
        mark.endBeat = Math.min(pieceEnd, Math.max(mark.beat, end));
        const last = ends.findIndex((beat) => beat >= mark.endBeat! - EPSILON);
        mark.endBar = Math.max(mark.bar, last < 0 ? ends.length : last + 1);
      }
    }
    const unique = new Map<string, ExpressionMark>();
    for (const mark of result) {
      const key = [mark.kind, mark.value, mark.beat.toFixed(6)].join(':');
      const old = unique.get(key);
      if (!old) unique.set(key, mark);
      else if (mark.kind === 'fermata') old.durationBeats = Math.max(old.durationBeats || 0, mark.durationBeats || 0);
    }
    return [...unique.values()].sort((a, b) => a.beat - b.beat || a.kind.localeCompare(b.kind));
  } catch {
    return [];
  }
}

function location(mark: ExpressionMark): string {
  return mark.endBar && mark.endBar > mark.bar ? 'bars ' + mark.bar + '-' + mark.endBar : 'bar ' + mark.bar;
}

function label(mark: ExpressionMark): string {
  return mark.kind === 'fermata' ? 'a fermata'
    : ['cresc', 'dim', 'rit', 'accel'].includes(mark.value) ? mark.value + '.' : mark.value;
}

export function describeMark(mark: ExpressionMark): string {
  const value = mark.kind === 'fermata' ? 'fermata' : label(mark);
  return value + (mark.endBar && mark.endBar > mark.bar ? ' ' : ' @ ') + location(mark)
    + (mark.source === 'omr' ? ' (scan)' : mark.source === 'page-read'
      ? ' (page read, ' + Math.round((mark.confidence ?? 0) * 100) + '%)' : '');
}

type Sample = Hit & { beat: number; measure: number; level?: number };
type Span = { mark: ExpressionMark; end: number; step: number; hits: Sample[]; held: Set<number>; closed: boolean };

function bpm(onsets: Sample[], minimum = 2): number | null {
  if (onsets.length < minimum) return null;
  const first = onsets[0], last = onsets[onsets.length - 1];
  const dt = last.timeMs - first.timeMs, beats = last.beat - first.beat;
  if (dt <= 0 || beats <= 0) return null;
  const value = beats / dt * 60000;
  return Number.isFinite(value) && value > 0 ? value : null;
}

export class ExpressionTracker {
  private marks: ExpressionMark[];
  private spans: Span[] = [];
  private history: Sample[] = [];
  private onsets: Sample[] = [];
  private done: ExpressionFinding[] = [];
  private previous: { index: number; median: number } | undefined;

  constructor(marks: ExpressionMark[], private steps: ScoreStep[]) {
    this.marks = [...marks].filter((m) => Number.isFinite(m.beat)).sort((a, b) => a.beat - b.beat);
    this.reset();
  }

  get findings(): ExpressionFinding[] { return [...this.done]; }

  reset(): void {
    this.onsets = []; this.done = []; this.previous = undefined;
    this.spans = this.marks.filter((m) => m.kind === 'fermata' || m.kind === 'wedge'
      || (m.kind === 'dynamic' && levelIndex(m.value) >= 0)
      || (m.kind === 'tempo' && (m.value === 'rit' || m.value === 'accel'))).map((mark) => {
      const next = this.marks.find((m) => m.kind === 'dynamic' && levelIndex(m.value) >= 0 && m.beat > mark.beat);
      const end = mark.kind === 'dynamic' ? next?.beat : mark.endBeat;
      return { mark, end: end !== undefined && Number.isFinite(end) ? end : Infinity,
        step: this.steps.findIndex((s) => s.notes.length > 0 && s.beat >= mark.beat - EPSILON),
        hits: [], held: new Set<number>(), closed: false };
    });
  }

  hit(h: Hit): ExpressionFinding[] {
    const step = this.steps[h.step], before = this.done.length;
    if (!step || !step.notes.length || ![h.step, h.note, h.velocity, h.timeMs, step.beat].every(Number.isFinite)) return [];
    const first = !this.onsets.some((s) => s.step === h.step);
    for (const span of this.spans) {
      if (span.mark.kind === 'fermata' ? first && h.step > span.step : step.beat >= span.end) this.close(span, h.timeMs);
    }
    let level: number | undefined;
    for (const mark of this.marks) {
      if (mark.beat <= step.beat && mark.kind === 'dynamic' && levelIndex(mark.value) >= 0) level = levelIndex(mark.value);
    }
    const sample: Sample = { ...h, velocity: Math.max(0, Math.min(127, h.velocity)), beat: step.beat, measure: step.measure, level };
    if (first) this.onsets.push(sample);
    this.history.push(sample);
    if (this.history.length > 400) this.history.shift();
    for (const span of this.spans) {
      if (!span.closed && (span.mark.kind === 'fermata' ? h.step === span.step
        : step.beat >= span.mark.beat && step.beat < span.end)) {
        span.hits.push(sample);
        if (span.mark.kind === 'fermata') span.held.add(h.note);
      }
    }
    return this.done.slice(before);
  }

  noteOff(note: number, timeMs: number): ExpressionFinding[] {
    const before = this.done.length;
    if (Number.isFinite(timeMs)) {
      for (const span of this.spans) {
        if (!span.closed && span.held.delete(note) && !span.held.size) this.close(span, timeMs);
      }
    }
    return this.done.slice(before);
  }

  finish(): ExpressionFinding[] {
    const before = this.done.length;
    for (const span of this.spans) {
      if (span.mark.kind !== 'fermata' || !span.held.size) this.close(span);
    }
    return this.done.slice(before);
  }

  private reference(bar: number): number | null {
    return bpm(this.onsets.filter((s) => s.measure >= bar - 2 && s.measure < bar), 3);
  }

  private close(span: Span, endTime?: number): void {
    if (span.closed || !span.hits.length) return;
    span.closed = true;
    const mark = span.mark, hits = span.hits;
    const detail: Record<string, number> = { n: hits.length };
    const prefix = mark.source === 'score' ? 'marked ' + label(mark)
      : mark.source === 'omr' ? 'the scan shows ' + label(mark)
      : 'the page read suggests ' + label(mark) + ' (' + Math.round((mark.confidence ?? 0) * 100) + '%)';
    // A dynamic lasts until the next one: name the bars he actually played under it.
    const where = mark.kind === 'dynamic' ? location({ ...mark, endBar: Math.max(...hits.map((h) => h.measure)) })
      : location(mark);
    const lead = where + ': ' + prefix + '; ';
    let ok: boolean | null = null, played = 'unknown', text = lead + 'not enough notes to tell';
    if (mark.kind === 'dynamic') {
      const velocity = median(hits.map((h) => h.velocity)), baseline = median(this.history.map((h) => h.velocity));
      const own = new Set(hits), outside = this.history.filter((h) => !own.has(h));
      detail.medianVelocity = velocity; detail.baseline = baseline;
      played = 'velocity ' + Math.round(velocity);
      text = lead + 'played at velocity ' + Math.round(velocity) + ', no baseline yet';
      if (this.previous) detail.contrast = velocity - this.previous.median;
      if (hits.length >= 4 && outside.length >= 16) {
        const levels = this.history.flatMap((h) => h.level === undefined ? [] : [h.level]);
        const anchor = levels.length ? levels.reduce((sum, n) => sum + n, 0) / levels.length : 3.5;
        const index = Math.max(0, Math.min(7, Math.round(anchor + (velocity - baseline) / VELOCITY_PER_LEVEL)));
        const expected = levelIndex(mark.value);
        ok = Math.abs(index - expected) <= 1; played = '~' + LEVELS[index];
        const change = this.previous ? expected - this.previous.index : 0;
        const little = this.previous && Math.abs(change) >= 2
          && (velocity - this.previous.median) * Math.sign(change) < 4;
        if (little) ok = false;
        text = lead + 'played about ' + LEVELS[index] + ' (velocity ' + Math.round(velocity)
          + ' vs his usual ' + Math.round(baseline) + ')';
        if (!ok) text += ' - ' + (index < expected || (index === expected && change > 0) ? 'softer' : 'louder') + ' than asked';
        if (little && this.previous) text += ', little change from the ' + LEVELS[this.previous.index] + ' before';
        this.previous = { index: expected, median: velocity };
      }
    } else if (mark.kind === 'wedge' && hits.length >= 4) {
      const ordered = [...hits].sort((a, b) => a.timeMs - b.timeMs);
      const third = Math.max(1, Math.floor(ordered.length / 3));
      const from = median(ordered.slice(0, third).map((h) => h.velocity));
      const to = median(ordered.slice(-third).map((h) => h.velocity)), change = to - from;
      Object.assign(detail, { from, to, change });
      played = change >= 6 ? 'louder' : change <= -6 ? 'softer' : 'level';
      ok = mark.value === 'cresc' ? change >= 6 : change <= -6;
      text = lead + 'velocity went ' + Math.round(from) + ' -> ' + Math.round(to)
        + ' (' + (played === 'level' ? 'about level' : played) + ')';
    } else if (mark.kind === 'tempo') {
      const onsets = this.onsets.filter((s) => s.beat >= mark.beat && s.beat < span.end);
      const end = Number.isFinite(span.end) ? span.end : onsets[onsets.length - 1]?.beat ?? mark.beat;
      const lastHalf = onsets.filter((s) => s.beat >= (mark.beat + end) / 2);
      const ref = this.reference(mark.bar), last = bpm(lastHalf.length >= 2 ? lastHalf : onsets);
      if (ref !== null) detail.refBpm = ref;
      if (last !== null) detail.endBpm = last;
      if (ref !== null && last !== null && Number.isFinite(last / ref) && last / ref > 0) {
        const ratio = last / ref;
        detail.tempoRatio = ratio;
        ok = mark.value === 'rit' ? ratio <= 0.92 : ratio >= 1.08;
        played = (ratio <= 0.92 ? 'slowed ' : ratio >= 1.08 ? 'sped up ' : 'steady ') + ratio.toFixed(2) + 'x';
        text = lead + 'tempo ' + Math.round(ref) + ' -> ' + Math.round(last) + ' bpm (' + ratio.toFixed(2) + 'x)';
        if (!ok) text += mark.value === 'rit' ? ' - no real slowing' : ' - no real speeding up';
      }
    } else if (mark.kind === 'fermata') {
      const ref = this.reference(mark.bar) ?? bpm(this.onsets.filter((s) => s.step < span.step).slice(-8));
      const onset = this.onsets.find((s) => s.step === span.step);
      if (ref !== null && onset && endTime !== undefined) {
        const writtenMs = (mark.durationBeats ?? 0) * 60000 / ref, holdMs = endTime - onset.timeMs;
        if (writtenMs > 0 && holdMs > 0 && Number.isFinite(writtenMs) && Number.isFinite(holdMs)) {
          const ratio = holdMs / writtenMs;
          Object.assign(detail, { refBpm: ref, writtenMs, holdMs, holdRatio: ratio });
          ok = ratio >= 1.4; played = 'held ' + ratio.toFixed(1) + 'x';
          text = lead + 'held ' + ratio.toFixed(1) + 'x its written length' + (ok ? '' : ' - not really held');
        }
      }
    }
    this.done.push({ kind: mark.kind, mark, expected: mark.value, played, ok, detail, text });
  }
}
