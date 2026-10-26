import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';
import { ExpressionTracker, describeMark, parseExpression } from '../src/renderer/engine/Expression';
import type { ExpressionFinding, ExpressionMark } from '../src/renderer/engine/Expression';
import { ScoreFollower } from '../src/renderer/engine/ScoreFollower';
import type { ScoreStep } from '../src/renderer/engine/ScoreFollower';

const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml') as unknown as Document;
const PIECE = readFileSync(new URL('../src/renderer/assets/expression-test.musicxml', import.meta.url), 'utf8');

// The test piece's steps as the Score view extracts them: bars 1-7 are four quarter
// notes, bar 8 two halves (the last with a fermata).
const MELODY = [60, 62, 64, 65, 67, 65, 64, 62, 60, 62, 64, 65, 67, 69, 71, 72,
  72, 71, 69, 67, 65, 67, 69, 71, 72, 71, 69, 67];
const STEPS: ScoreStep[] = [
  ...MELODY.map((note, i) => ({ notes: [note], beat: i, measure: Math.floor(i / 4) + 1 })),
  { notes: [64], beat: 28, measure: 8 },
  { notes: [60], beat: 30, measure: 8 },
];

type Take = { note: number; velocity: number; on: number; off: number }[];

/**
 * A take of the test piece: one note-on per step at `beatMs(i)` intervals, released
 * just before the next onset (the last note after `lastHoldMs`).
 */
function take(velocity: (i: number) => number, beatMs: (i: number) => number, lastHoldMs: number): Take {
  const out: Take = [];
  let t = 1000;
  STEPS.forEach((step, i) => {
    const next = i + 1 < STEPS.length ? STEPS[i + 1].beat - step.beat : 0;
    const gap = next * beatMs(i);
    out.push({ note: step.notes[0], velocity: velocity(i), on: t, off: i + 1 < STEPS.length ? t + gap - 20 : t + lastHoldMs });
    t += gap;
  });
  return out;
}

// As marked: p (~45) with the cresc. rising to ~72, f (~80); 90 bpm slowing through
// bars 7-8; the fermata held ~2.5x.
const AS_MARKED = take(
  (i) => (i < 8 ? 45 : i < 16 ? 48 + Math.round((i - 8) * 3.5) : 80),
  (i) => (i < 24 ? 667 : 667 + (i - 23) * 120),
  3500,
);
// Flat: one loudness throughout, metronomic, the last note held only its written length.
const FLAT = take(() => 64, () => 667, 1334);

/** Play a take through the follower and tracker the way ScoreView does. */
function play(tracker: ExpressionTracker, events: Take): ExpressionFinding[] {
  const follower = new ScoreFollower(STEPS);
  const found: ExpressionFinding[] = [];
  const timeline = events.flatMap((e) => [
    { t: e.on, kind: 'on' as const, e },
    { t: e.off, kind: 'off' as const, e },
  ]).sort((a, b) => a.t - b.t || (a.kind === 'off' ? -1 : 1));
  for (const { t, kind, e } of timeline) {
    if (kind === 'off') {
      found.push(...tracker.noteOff(e.note, t));
      continue;
    }
    const idx = follower.index;
    const result = follower.noteOn(e.note, t);
    if (result.kind === 'wrong' || result.kind === 'ignored') continue;
    found.push(...tracker.hit({ step: idx, note: e.note, velocity: e.velocity, timeMs: t }));
    if (result.kind === 'complete') found.push(...tracker.finish());
  }
  return found;
}

const byKind = (found: ExpressionFinding[], kind: ExpressionMark['kind'], value?: string) =>
  found.filter((f) => f.kind === kind && (value === undefined || f.mark.value === value));

describe('parseExpression', () => {
  it('reads the test piece: p, cresc. bars 3-4, f, rit. bars 7-8, a fermata', () => {
    const marks = parseExpression(PIECE, parse);
    const brief = marks.map((m) => [m.kind, m.value, m.bar, m.beat, m.endBar, m.endBeat, m.source]);
    expect(brief).toEqual(expect.arrayContaining([
      ['dynamic', 'p', 1, 0, undefined, undefined, 'score'],
      ['wedge', 'cresc', 3, 8, 4, 16, 'score'],
      ['dynamic', 'f', 5, 16, undefined, undefined, 'score'],
      ['tempo', 'rit', 7, 24, 8, 32, 'score'],
      ['fermata', 'fermata', 8, 30, undefined, undefined, 'score'],
    ]));
    expect(marks).toHaveLength(5);
    expect(marks.find((m) => m.kind === 'fermata')?.durationBeats).toBe(2);
    expect(marks.map(describeMark)).toContain('rit. bars 7-8');
  });

  it('tags a page-read mark with its confidence and a homr scan as omr', () => {
    const xml = `<?xml version="1.0"?><score-partwise version="3.1">
      <identification><encoding><software>homr</software></encoding></identification>
      <part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>
      <part id="P1">
        <measure number="1"><attributes><divisions>2</divisions></attributes>
          <direction id="pageread-85-1"><direction-type><dynamics><mf/></dynamics></direction-type></direction>
          <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note>
          <direction><direction-type><words>poco rit.</words></direction-type></direction>
          <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><notations><fermata/></notations></note>
        </measure>
        <measure number="2"><note><pitch><step>E</step><octave>4</octave></pitch><duration>8</duration></note></measure>
      </part></score-partwise>`;
    const marks = parseExpression(xml, parse);
    const mf = marks.find((m) => m.value === 'mf');
    expect(mf).toMatchObject({ source: 'page-read', confidence: 0.85, bar: 1, beat: 0 });
    expect(describeMark(mf!)).toContain('page read, 85%');
    const rit = marks.find((m) => m.value === 'rit');
    expect(rit).toMatchObject({ source: 'omr', bar: 1, beat: 2, text: 'poco rit.' });
    // No dashes: the span runs to the piece end at most.
    expect(rit!.endBeat).toBe(8);
    expect(marks.find((m) => m.kind === 'fermata')).toMatchObject({ beat: 2, durationBeats: 2, source: 'omr' });
  });

  it('returns nothing for junk instead of throwing', () => {
    expect(parseExpression('not xml at all', parse)).toEqual([]);
    expect(parseExpression('<score-timewise/>', parse)).toEqual([]);
  });
});

describe('ExpressionTracker on recorded takes of the test piece', () => {
  const marks = () => parseExpression(PIECE, parse);

  it('played as marked: every mark comes out ok', () => {
    const tracker = new ExpressionTracker(marks(), STEPS);
    const first = play(tracker, AS_MARKED);
    // First pass: no baseline of his yet for the opening p.
    expect(byKind(first, 'dynamic', 'p')[0]).toMatchObject({ ok: null });
    expect(byKind(first, 'dynamic', 'p')[0].text).toContain('no baseline yet');
    tracker.reset();
    const found = play(tracker, AS_MARKED);
    expect(found.map((f) => [f.kind, f.mark.value, f.ok])).toEqual(expect.arrayContaining([
      ['dynamic', 'p', true],
      ['dynamic', 'f', true],
      ['wedge', 'cresc', true],
      ['tempo', 'rit', true],
      ['fermata', 'fermata', true],
    ]));
    expect(found).toHaveLength(5);
    expect(byKind(found, 'tempo')[0].text).toMatch(/^bars 7-8: marked rit\.; tempo 90 -> \d+ bpm \(0\.\d\dx\)$/);
    expect(byKind(found, 'wedge')[0].text).toContain('louder');
    expect(byKind(found, 'dynamic', 'f')[0].text).toMatch(/^bars 5-8: marked f; played about (mf|f|ff) /);
  });

  it('played flat: f shows little change, no cresc., no rit., fermata not held', () => {
    const tracker = new ExpressionTracker(marks(), STEPS);
    play(tracker, FLAT);
    tracker.reset();
    const found = play(tracker, FLAT);
    const f = byKind(found, 'dynamic', 'f')[0];
    expect(f.ok).toBe(false);
    expect(f.text).toContain('little change from the p before');
    expect(byKind(found, 'wedge')[0]).toMatchObject({ ok: false, played: 'level' });
    const rit = byKind(found, 'tempo')[0];
    expect(rit.ok).toBe(false);
    expect(rit.text).toContain('no real slowing');
    expect(byKind(found, 'fermata')[0].ok).toBe(false);
    expect(byKind(found, 'fermata')[0].text).toContain('not really held');
  });

  it('page-read marks are hedged in the text', () => {
    const hedged = marks().map((m) => ({ ...m, source: 'page-read' as const, confidence: 0.82 }));
    const tracker = new ExpressionTracker(hedged, STEPS);
    play(tracker, AS_MARKED);
    tracker.reset();
    const rit = byKind(play(tracker, AS_MARKED), 'tempo')[0];
    expect(rit.text).toContain('the page read suggests rit. (82%)');
  });

  it('a pass that skips a span says nothing about it', () => {
    const tracker = new ExpressionTracker(marks(), STEPS);
    // Only bars 1-2, then he stops and restarts.
    for (const [i, e] of AS_MARKED.slice(0, 8).entries()) {
      tracker.hit({ step: i, note: e.note, velocity: e.velocity, timeMs: e.on });
    }
    tracker.reset();
    expect(tracker.findings).toEqual([]);
    expect(tracker.finish()).toEqual([]);
  });
});
