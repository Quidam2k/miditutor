/**
 * #6654 recovery: replay a day log's finger edits (fingering + fingering-spread events) onto a
 * score, as the app would have saved them. Read-only on its inputs; writes only --out.
 *
 *   npx tsx scripts/replay_fingering_log.ts --log <day.jsonl> --from <ms> --to <ms> \
 *     --edited <copy he edited.musicxml> --target <real score.musicxml> --out <result.musicxml>
 *
 * Every edit is replayed on BOTH copies. A bar whose notes differ between them is skipped and
 * listed; a tap whose note isn't on both is listed; a spread's changes on the target must equal
 * its changes on the edited copy (and its applied count must match the log). Prints a per-bar
 * diff of the target's fingers, before -> after.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { setFingering, spreadFingering, type Digit, type FingerTarget, type XmlImpl } from '../src/shared/fingering';

const impl: XmlImpl = {
  parse: (s) => new DOMParser().parseFromString(s, 'text/xml') as unknown as Document,
  serialize: (d) => new XMLSerializer().serializeToString(d as never),
};

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`missing --${name}`);
  return process.argv[i + 1];
};

interface LogEvent { kind: string; timestamp: number; seq: number; measure: number; staff: number; onset: number; midi: number; digit?: string | null; name?: string; applied?: number }

const from = Number(arg('from'));
const to = Number(arg('to'));
const events: LogEvent[] = readFileSync(arg('log'), 'utf8').split('\n').filter(Boolean)
  .map((l) => JSON.parse(l) as LogEvent)
  .filter((e) => (e.kind === 'fingering' || e.kind === 'fingering-spread') && e.timestamp >= from && e.timestamp <= to)
  .sort((a, b) => a.seq - b.seq);

let edited = readFileSync(arg('edited'), 'utf8');
const original = readFileSync(arg('target'), 'utf8');
let target = original;

// Bars (by position, 1-based, per part) whose notes differ between the copies, fingers ignored.
const measures = (xml: string) => [...xml.matchAll(/<measure\b[\s\S]*?<\/measure>/g)].map((m) => m[0]);
// A bar's notes: staff, pitch, length, chord/rest/grace. Ties, marks and fingers are not notes.
const bare = (m: string) => [...m.matchAll(/<note[\s\S]*?<\/note>/g)].map(([n]) => [
  /<staff>(\d)/.exec(n)?.[1] ?? '1', n.includes('<rest') ? 'rest' : /<step>(\w)/.exec(n)?.[1],
  /<alter>(-?\d)/.exec(n)?.[1] ?? '0', /<octave>(\d)/.exec(n)?.[1] ?? '', /<duration>(\d+)/.exec(n)?.[1] ?? 'g',
  n.includes('<chord') ? 'c' : '',
].join(':')).sort().join('|');
const em = measures(edited);
const tm = measures(target);
const perPart = Math.max(...[...original.matchAll(/<part\b[^>]*>([\s\S]*?)<\/part>/g)].map((p) => (p[1].match(/<measure\b/g) ?? []).length));
const differs = new Set<number>();
for (let i = 0; i < Math.max(em.length, tm.length); i++) if (bare(em[i] ?? '') !== bare(tm[i] ?? '')) differs.add((i % perPart) + 1);

const problems: string[] = [];
const key = (c: FingerTarget & { digit: string }) => `${c.measure}/${c.staff}/${c.onset}/${c.midi}=${c.digit}`;
let taps = 0;
let spreads = 0;
for (const e of events) {
  const t: FingerTarget = { measure: e.measure, staff: e.staff, onset: e.onset, midi: e.midi };
  const label = `seq ${e.seq} ${e.kind} bar ${e.measure} ${e.name ?? e.midi}`;
  if (differs.has(e.measure)) {
    problems.push(`${label}: SKIPPED, bar ${e.measure} differs between the copies`);
    continue;
  }
  if (e.kind === 'fingering') {
    const a = setFingering(edited, t, (e.digit ?? null) as Digit | null, impl);
    const b = setFingering(target, t, (e.digit ?? null) as Digit | null, impl);
    if (!a.ok || !b.ok) {
      problems.push(`${label}: SKIPPED, note not found (edited: ${a.ok ? 'ok' : a.reason}; target: ${b.ok ? 'ok' : b.reason})`);
      continue;
    }
    edited = a.xml;
    target = b.xml;
    taps++;
    continue;
  }
  const a = spreadFingering(edited, t, impl);
  const b = spreadFingering(target, t, impl);
  if (!a.ok || !b.ok) {
    problems.push(`${label}: SKIPPED spread (edited: ${a.ok ? 'ok' : a.reason}; target: ${b.ok ? 'ok' : b.reason})`);
    continue;
  }
  if (a.applied !== e.applied) problems.push(`${label}: replay applied ${a.applied} on the edited copy, log says ${e.applied}`);
  const want = new Set(a.changes.map(key));
  const got = new Set(b.changes.map(key));
  const onlyEdited = [...want].filter((k) => !got.has(k));
  const onlyTarget = [...got].filter((k) => !want.has(k));
  edited = a.xml;
  // On the target, only the changes the edited copy also made, and none in a differing bar.
  for (const c of b.changes) {
    if (!want.has(key(c)) || differs.has(c.measure)) continue;
    const r = setFingering(target, c, c.digit, impl);
    if (r.ok) target = r.xml;
    else problems.push(`${label}: spread change ${key(c)} failed on target: ${r.reason}`);
  }
  if (onlyEdited.length || onlyTarget.length) {
    problems.push(`${label}: spread differs; only on edited copy: [${onlyEdited.join(' ')}]; only on target (not applied): [${onlyTarget.join(' ')}]`);
  }
  spreads++;
}

// Per-bar diff of the target: each note's finger before -> after, by staff.
const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const fingersOf = (m: string) => [...m.matchAll(/<note\b[\s\S]*?<\/note>/g)].map((n) => n[0]).filter((n) => !n.includes('<rest')).map((n) => {
  const step = /<step>(\w)<\/step>/.exec(n)?.[1] ?? '?';
  const alter = Number(/<alter>(-?\d)<\/alter>/.exec(n)?.[1] ?? 0);
  const octave = Number(/<octave>(\d)<\/octave>/.exec(n)?.[1] ?? 0);
  return { staff: /<staff>(\d)<\/staff>/.exec(n)?.[1] ?? '1', name: `${step}${alter < 0 ? 'b' : alter > 0 ? '#' : ''}${octave}`, midi: 12 * (octave + 1) + (STEP[step] ?? 0) + alter, finger: /<fingering[^>]*>(\d)<\/fingering>/.exec(n)?.[1] ?? '-' };
});
const before = measures(original);
const after = measures(target);
const lines: string[] = [];
let changed = 0;
for (let i = 0; i < after.length; i++) {
  const x = fingersOf(before[i]);
  const y = fingersOf(after[i]);
  const diffs = y.map((n, j) => (n.finger !== x[j]?.finger ? `${n.staff === '1' ? 'RH' : 'LH'} ${n.name} ${x[j]?.finger ?? '?'}->${n.finger}` : '')).filter(Boolean);
  if (diffs.length) {
    changed += diffs.length;
    lines.push(`bar ${(i % perPart) + 1}: ${diffs.join(', ')}`);
  }
}

writeFileSync(arg('out'), target, 'utf8');
console.log(`events ${events.length}: ${taps} taps + ${spreads} spreads replayed; bars differing between copies: ${[...differs].sort((a, b) => a - b).join(', ') || 'none'}`);
console.log(`notes whose finger changed on the target: ${changed}`);
console.log(lines.join('\n'));
console.log(problems.length ? `PROBLEMS (${problems.length}):\n${problems.join('\n')}` : 'PROBLEMS: none');
