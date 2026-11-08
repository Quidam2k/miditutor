// #5652 D confusion pairs: wrong keys, live pairs, and their drill pool. Pure logic.
import { Clef, Pitch } from '../types/music';
import { NOTE_RANGE, TrainerNote } from './NoteTrainer';
import { pitchToMidiNumber } from './MusicTheory';

export interface MixUp { asked: string; played: string; count: number; since: number; last: string }
export type MixUps = Record<string, MixUp>;
export const SHOW_MIN_COUNT = 2;
export const CLEARED_AFTER = 5;
export const MAX_PAIRS = 200;

const NAME = /^([A-G])(#|b)?(-?\d+)$/;
const ASKED = /^(treble|bass):([A-G](#|b)?-?\d+)$/;
const LETTERS = 'CDEFGAB';
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const otherClef = (clef: Clef): Clef => clef === 'treble' ? 'bass' : 'treble';

const parsePitch = (name: string): Pitch | null => {
  const m = NAME.exec(name);
  if (!m) return null;
  const note = m[1] as Pitch['note'];
  const octave = Number(m[3]);
  const accidental = m[2] === '#' ? 'sharp' : m[2] === 'b' ? 'flat' : undefined;
  const midiNumber = pitchToMidiNumber(note, octave, accidental);
  if (!Number.isFinite(octave) || !Number.isFinite(midiNumber)) return null;
  return { note, ...(accidental ? { accidental } : {}), octave, midiNumber };
};

const step = (pitch: Pitch): number => pitch.octave * 7 + LETTERS.indexOf(pitch.note);

export function recordMixUp(mix: MixUps, askedId: string, playedName: string, day: string): MixUps {
  const key = `${askedId}>${playedName}`;
  const out: MixUps = {
    ...mix,
    [key]: { asked: askedId, played: playedName, count: (mix[key]?.count ?? 0) + 1, since: 0, last: day },
  };
  const keys = Object.keys(out);
  if (keys.length > MAX_PAIRS) {
    const oldest = keys.filter((k) => k !== key).sort((a, b) =>
      compare(out[a].last, out[b].last) || out[a].count - out[b].count || compare(a, b));
    for (const k of oldest.slice(0, keys.length - MAX_PAIRS)) delete out[k];
  }
  return out;
}

export function recordRight(mix: MixUps, askedId: string): MixUps {
  let out = mix;
  for (const [key, pair] of Object.entries(mix)) {
    if (pair.asked !== askedId) continue;
    if (out === mix) out = { ...mix };
    out[key] = { ...pair, since: pair.since + 1 };
  }
  return out;
}

export function liveMixUps(mix: MixUps): MixUp[] {
  return Object.entries(mix)
    .filter(([, pair]) => pair.count >= SHOW_MIN_COUNT && pair.since < CLEARED_AFTER)
    .sort(([ka, a], [kb, b]) => b.count - a.count || compare(b.last, a.last) || compare(ka, kb))
    .map(([, pair]) => pair);
}

export type MixUpKind = 'other-clef' | 'octave' | 'step' | 'third' | 'other';

export function mixUpKind(askedId: string, playedName: string): MixUpKind {
  const m = ASKED.exec(askedId);
  if (!m) return 'other';
  const asked = parsePitch(m[2]);
  const played = parsePitch(playedName);
  if (!asked || !played) return 'other';
  const distance = Math.abs(step(asked) - step(played));
  // The other clef's letter is always a third away (12 steps is 5 mod 7), so the near third stays a line-off misread.
  if (distance === 2) return 'third';
  const otherStep = step(asked) + (m[1] === 'bass' ? 12 : -12);
  if (played.note === LETTERS[((otherStep % 7) + 7) % 7]) return 'other-clef';
  if (asked.note === played.note && asked.octave !== played.octave) return 'octave';
  if (distance === 1) return 'step';
  return 'other';
}

export function mixUpLabel(kind: MixUpKind, askedClef: 'treble' | 'bass'): string {
  switch (kind) {
    case 'other-clef': return `read as ${otherClef(askedClef)} clef`;
    case 'octave': return 'octave off';
    case 'step': return 'one step off';
    case 'third': return 'a line or space off';
    default: return '';
  }
}

export function playedClef(playedMidi: number, askedClef: Clef): Clef | null {
  const contains = (clef: Clef) => playedMidi >= NOTE_RANGE[clef][0] && playedMidi <= NOTE_RANGE[clef][1];
  if (contains(askedClef)) return askedClef;
  const other = otherClef(askedClef);
  return contains(other) ? other : null;
}

export function drillPool(live: MixUp[]): TrainerNote[] {
  const out: TrainerNote[] = [];
  const seen = new Set<string>();
  const add = (id: string, clef: Clef, pitch: Pitch) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, clef, pitch });
  };
  for (const pair of live) {
    const m = ASKED.exec(pair.asked);
    if (!m) continue;
    const asked = parsePitch(m[2]);
    if (!asked) continue;
    const clef = m[1] as Clef;
    add(pair.asked, clef, asked);
    const played = parsePitch(pair.played);
    if (!played) continue;
    const target = playedClef(played.midiNumber, clef);
    if (target !== null) add(`${target}:${pair.played}`, target, played);
  }
  return out;
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

export function parseMixUps(raw: unknown): MixUps {
  const out: MixUps = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    if (key === '__proto__' || !v || typeof v !== 'object' || Array.isArray(v)) continue;
    const { asked, played, count, since, last } = v as Record<string, unknown>;
    if (typeof asked !== 'string' || !ASKED.test(asked)) continue;
    if (typeof played !== 'string' || !NAME.test(played)) continue;
    if (key !== `${asked}>${played}`) continue;
    if (!isCount(count) || count === 0 || !isCount(since) || typeof last !== 'string') continue;
    out[key] = { asked, played, count, since, last };
  }
  return out;
}
