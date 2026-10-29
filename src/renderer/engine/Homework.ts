/** One item of homework.json (written by scripts/homework_sync.py from the teacher's lesson log). */
export interface HomeworkItem {
  /** "scale:E-minor", "arpeggio:E-minor", "triads", "intervals", "piece:...", "task:...", "note-id" */
  id: string;
  kind: 'scale' | 'arpeggio' | 'triads' | 'intervals' | 'piece' | 'task' | 'note-id';
  label: string;
  source: string;
  /** "E", "F#", "Bb" */
  key?: string;
  quality?: 'major' | 'minor';
  /** Scale only: ["major"] or a subset of ["natural","harmonic","melodic"]; [] = teacher didn't say. */
  types?: string[];
  fingering?: Record<string, string>;
  notes?: string[];
  /** Triads: {"WWW": ["C","F","Dm"], "BBB": ["F#/Gb"], "B": "WBB"}. */
  groups?: Record<string, string[] | string>;
  intervals?: string[];
  daily_goal?: number | null;
  title?: string;
  file?: string | null;
  url?: string | null;
}

export interface Homework {
  date: string;
  items: HomeworkItem[];
  unparsed: string[];
  flags: string[];
}

export type ScaleType = 'major' | 'natural' | 'harmonic' | 'melodic';

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

const mod12 = (n: number): number => ((n % 12) + 12) % 12;

/** Pitch class of a key name: "C" = 0 ... "B" = 11, "#" / "b" suffixes move it a semitone. */
export function keyPitchClass(key: string): number {
  const base = LETTER_PC[key.charAt(0).toUpperCase()];
  if (base === undefined) throw new Error(`Bad key name: ${key}`);
  let pc = base;
  for (const ch of key.slice(1)) {
    if (ch === '#') pc += 1;
    else if (ch === 'b') pc -= 1;
  }
  return mod12(pc);
}

const MAJOR_UP = [2, 2, 1, 2, 2, 2, 1];
const NATURAL_UP = [2, 1, 2, 2, 1, 2, 2];
const HARMONIC_UP = [2, 1, 2, 2, 1, 3, 1];
const MELODIC_UP = [2, 1, 2, 2, 2, 2, 1];

/** Semitone steps for one octave, up from the tonic and down from the top tonic. */
export function scaleSteps(type: ScaleType): { up: number[]; down: number[] } {
  const rev = (steps: number[]): number[] => [...steps].reverse();
  switch (type) {
    case 'major': return { up: MAJOR_UP, down: rev(MAJOR_UP) };
    case 'natural': return { up: NATURAL_UP, down: rev(NATURAL_UP) };
    case 'harmonic': return { up: HARMONIC_UP, down: rev(HARMONIC_UP) };
    case 'melodic': return { up: MELODIC_UP, down: rev(NATURAL_UP) };
  }
}

/** Offsets from the tonic for a full up-and-down pass (top tonic once), e.g. 15 notes. */
export function scaleOffsets(type: ScaleType): number[] {
  const { up, down } = scaleSteps(type);
  const offsets = [0];
  for (const s of up) offsets.push(offsets[offsets.length - 1] + s);
  for (const s of down) offsets.push(offsets[offsets.length - 1] - s);
  return offsets;
}

/** Offsets for a one-octave arpeggio up and back down. */
export function arpeggioOffsets(quality: 'major' | 'minor'): number[] {
  return quality === 'major' ? [0, 4, 7, 12, 7, 4, 0] : [0, 3, 7, 12, 7, 3, 0];
}

/** Letter steps above the tonic for each semitone offset within an octave. */
const DEGREE_OF_SEMITONE = [0, 1, 1, 2, 2, 3, 3, 4, 5, 5, 6, 6];

/** Spelled note names for display, stepping through consecutive letters (E harmonic -> E F# G A B C D# E). */
export function noteNames(key: string, offsets: number[]): string[] {
  const tonicLetter = LETTERS.indexOf(key.charAt(0).toUpperCase());
  const tonicPc = keyPitchClass(key);
  return offsets.map((offset) => {
    const within = mod12(offset);
    const degree = DEGREE_OF_SEMITONE[within];
    const letter = LETTERS[(tonicLetter + degree) % 7];
    let diff = mod12(tonicPc + within - LETTER_PC[letter]);
    if (diff > 6) diff -= 12;
    if (diff === 0) return letter;
    return letter + (diff > 0 ? '#'.repeat(diff) : 'b'.repeat(-diff));
  });
}

export interface SequenceState {
  offsets: number[];
  base: number | null;
  index: number;
  mistakes: number;
}

/** A fresh sequence: no base note yet, nothing played. */
export function startSequence(offsets: number[]): SequenceState {
  return { offsets, base: null, index: 0, mistakes: 0 };
}

/** MIDI numbers that would be accepted next (any-octave tonic to start; [] when done). */
export function expectedNext(s: SequenceState, tonicPc: number): number[] {
  if (s.index >= s.offsets.length) return [];
  if (s.base === null) {
    const all: number[] = [];
    for (let m = 21; m <= 108; m++) if (m % 12 === tonicPc) all.push(m);
    return all;
  }
  return [s.base + s.offsets[s.index]];
}

/** Feed one played note. A wrong note counts a mistake but keeps progress. */
export function playNote(
  s: SequenceState,
  midi: number,
  tonicPc: number,
): { state: SequenceState; ok: boolean; done: boolean } {
  const finished = (st: SequenceState): boolean => st.index === st.offsets.length;
  if (finished(s)) return { state: s, ok: false, done: true };
  if (s.base === null) {
    if (midi % 12 === tonicPc) {
      const state = { ...s, base: midi, index: 1 };
      return { state, ok: true, done: finished(state) };
    }
  } else if (midi === s.base + s.offsets[s.index]) {
    const state = { ...s, index: s.index + 1 };
    return { state, ok: true, done: finished(state) };
  }
  return { state: { ...s, mistakes: s.mistakes + 1 }, ok: false, done: false };
}

export interface TriadTarget {
  name: string;
  display: string;
  pcs: number[];
  colour: string | null;
}

const CHORD_RE = /^([A-G][#b]?)(m?)$/;
const GROUP_RE = /^[WB]{3}$/;

function chordPcs(chord: string): number[] | null {
  const m = CHORD_RE.exec(chord.trim());
  if (!m) return null;
  const root = keyPitchClass(m[1]);
  return [root, mod12(root + (m[2] ? 3 : 4)), mod12(root + 7)].sort((a, b) => a - b);
}

/** Turn homework triad groups into targets, one per chord (enharmonic pairs "F#/Gb" merge), deduped by name. */
export function triadsFromGroups(groups: Record<string, string[] | string>): TriadTarget[] {
  const targets: TriadTarget[] = [];
  const seen = new Set<string>();
  const add = (spec: string, colour: string): void => {
    const spellings = spec.split('/').map((p) => p.trim());
    const name = spellings[0];
    const pcs = chordPcs(name);
    if (!pcs || seen.has(name)) return;
    seen.add(name);
    targets.push({ name, display: spellings.join(' / '), pcs, colour });
  };
  for (const [key, value] of Object.entries(groups)) {
    if (GROUP_RE.test(key) && Array.isArray(value)) value.forEach((c) => add(c, key));
    else if (typeof value === 'string') add(key, value);
  }
  return targets;
}

/** "Ebm" -> "E flat minor", "F#" -> "F sharp major". */
export function triadDisplayName(name: string): string {
  const m = CHORD_RE.exec(name.trim());
  if (!m) return name;
  const acc = m[1].endsWith('#') ? ' sharp' : m[1].endsWith('b') ? ' flat' : '';
  return `${m[1].charAt(0)}${acc} ${m[2] ? 'minor' : 'major'}`;
}

/** True when the held keys make exactly this triad (any inversion or octave, doublings allowed). */
export function matchesTriad(held: Iterable<number>, pcs: number[]): boolean {
  const heldPcs = new Set([...held].map(mod12));
  return heldPcs.size === pcs.length && pcs.every((p) => heldPcs.has(p));
}

/** Never-practiced items first (shuffled), then the rest oldest-practiced first. */
export function orderUnpracticed<T extends { id: string }>(
  items: T[],
  practiced: Record<string, string>,
  rng: () => number = Math.random,
): T[] {
  const fresh = items.filter((i) => !practiced[i.id]);
  for (let i = fresh.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [fresh[i], fresh[j]] = [fresh[j], fresh[i]];
  }
  const rest = items
    .filter((i) => practiced[i.id])
    .sort((a, b) => (practiced[a.id] < practiced[b.id] ? -1 : practiced[a.id] > practiced[b.id] ? 1 : 0));
  return [...fresh, ...rest];
}

/** #10133: a piece the teacher says to practise backwards gets the Score tab's how-to. */
export function backwardsHint(item: HomeworkItem): string | null {
  if (item.kind !== 'piece') return null;
  const text = [item.label, ...(item.notes ?? [])].join(' ');
  return /backward/i.test(text) ? 'Score tab: Loop bars on your section, then Build backwards' : null;
}
