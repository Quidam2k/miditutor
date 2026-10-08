export type Spelled = {
  letter: 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
  alter: number;
};

const NATURAL_PITCH_CLASSES: Record<Spelled['letter'], number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const SHARP_NAMES = [
  'C', 'C#', 'D', 'D#', 'E', 'F',
  'F#', 'G', 'G#', 'A', 'A#', 'B',
] as const;

function mod12(n: number): number {
  return ((n % 12) + 12) % 12;
}

export function parseSpelled(s: string): Spelled {
  const match = /^([a-g])(#{1,2}|b{1,2}|\s+(?:flat|sharp|double\s+flat|double\s+sharp))?$/i.exec(s.trim());

  if (!match) {
    throw new Error(`Invalid spelled note: ${s}`);
  }

  const letter = match[1]!.toUpperCase() as Spelled['letter'];
  const accidental = (match[2] ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

  let alter: number;

  switch (accidental) {
    case '':
      alter = 0;
      break;
    case '#':
    case 'sharp':
      alter = 1;
      break;
    case '##':
    case 'double sharp':
      alter = 2;
      break;
    case 'b':
    case 'flat':
      alter = -1;
      break;
    case 'bb':
    case 'double flat':
      alter = -2;
      break;
    default:
      throw new Error(`Invalid spelled note: ${s}`);
  }

  return { letter, alter };
}

export function spelledToString(s: Spelled): string {
  switch (s.alter) {
    case -2:
      return `${s.letter}bb`;
    case -1:
      return `${s.letter}b`;
    case 0:
      return s.letter;
    case 1:
      return `${s.letter}#`;
    case 2:
      return `${s.letter}##`;
    default:
      throw new Error(`Invalid alteration: ${s.alter}`);
  }
}

export function pitchClass(s: Spelled): number {
  return mod12(NATURAL_PITCH_CLASSES[s.letter] + s.alter);
}

export function midiName(m: number): string {
  return `${SHARP_NAMES[mod12(m)]!}${Math.floor(m / 12) - 1}`;
}

type ChordPattern = {
  intervals: readonly number[];
  quality: string;
  suffix: string;
  symmetric?: boolean;
};

const CHORD_PATTERNS: readonly ChordPattern[] = [
  { intervals: [0, 4, 7], quality: 'major', suffix: ' major' },
  { intervals: [0, 3, 7], quality: 'minor', suffix: ' minor' },
  { intervals: [0, 3, 6], quality: 'diminished', suffix: ' diminished' },
  {
    intervals: [0, 4, 8],
    quality: 'augmented',
    suffix: ' augmented',
    symmetric: true,
  },
  { intervals: [0, 4, 7, 10], quality: 'dominant 7', suffix: '7' },
  { intervals: [0, 4, 7, 11], quality: 'major 7', suffix: 'maj7' },
  { intervals: [0, 3, 7, 10], quality: 'minor 7', suffix: 'm7' },
  { intervals: [0, 3, 6, 10], quality: 'half-diminished', suffix: 'm7b5' },
  {
    intervals: [0, 3, 6, 9],
    quality: 'diminished 7',
    suffix: 'dim7',
    symmetric: true,
  },
];

function rootName(pc: number, quality: string): string {
  // Use Bb, Eb, Ab; use Db for major triads; otherwise use sharps.
  if (pc === 10) return 'Bb';
  if (pc === 3) return 'Eb';
  if (pc === 8) return 'Ab';
  if (pc === 1 && quality === 'major') return 'Db';
  return SHARP_NAMES[pc]!;
}

export function nameChord(midis: number[]): {
  name: string;
  root: string;
  quality: string;
  inversion: number;
  bass: string;
} | null {
  const pcs = new Set(midis.map(mod12));

  if (pcs.size < 3 || pcs.size > 4) {
    return null;
  }

  const bassMidi = Math.min(...midis);
  const bassPc = mod12(bassMidi);
  const candidates = [...pcs].sort((a, b) => a - b);

  for (const pattern of CHORD_PATTERNS) {
    if (pattern.intervals.length !== pcs.size) continue;

    for (const rootPc of candidates) {
      // Symmetric chords use the bass as their root.
      if (pattern.symmetric && rootPc !== bassPc) continue;

      const matches = pattern.intervals.every((interval) =>
        pcs.has(mod12(rootPc + interval)),
      );

      if (!matches) continue;

      const root = rootName(rootPc, pattern.quality);

      return {
        name: `${root}${pattern.suffix}`,
        root,
        quality: pattern.quality,
        inversion: pattern.intervals.indexOf(mod12(bassPc - rootPc)),
        bass: midiName(bassMidi),
      };
    }
  }

  return null;
}

export function checkChord(expected: string[], played: number[]): {
  verdict: 'correct' | 'wrong' | 'incomplete';
  missing: string[];
  extra: string[];
} {
  const spelled = expected.map(parseSpelled);
  const expectedPcs = new Set(spelled.map(pitchClass));
  const playedPcs = new Set(played.map(mod12));

  const missing = spelled
    .filter((note) => !playedPcs.has(pitchClass(note)))
    .map(spelledToString);

  const extra = played
    .filter((midi) => !expectedPcs.has(mod12(midi)))
    .map(midiName);

  let verdict: 'correct' | 'wrong' | 'incomplete' = 'wrong';

  if (playedPcs.size > 0 && extra.length === 0) {
    verdict = missing.length === 0 ? 'correct' : 'incomplete';
  }

  return { verdict, missing, extra };
}

export type Gesture = {
  id: number;
  notes: number[];
  names: string[];
  chord: ReturnType<typeof nameChord>;
  startedAt: number;
  endedAt: number;
};

type OpenGesture = {
  notes: Set<number>;
  startedAt: number;
  lastNoteOnAt: number;
};

export class GestureTracker {
  private readonly windowMs: number;
  private nextId = 1;
  private open: OpenGesture | null = null;

  constructor(opts?: { windowMs?: number }) {
    this.windowMs = opts?.windowMs ?? 120;
  }

  noteOn(midi: number, t: number): void {
    if (this.open === null) {
      this.open = {
        notes: new Set([midi]),
        startedAt: t,
        lastNoteOnAt: t,
      };
      return;
    }

    this.open.notes.add(midi);
    this.open.lastNoteOnAt = t;
  }

  noteOff(_midi: number, _t: number): void {
    // Releases do not affect gesture grouping.
  }

  tick(t: number): Gesture | null {
    if (this.open === null || t - this.open.lastNoteOnAt < this.windowMs) {
      return null;
    }

    return this.close();
  }

  flush(_t: number): Gesture | null {
    return this.close();
  }

  private close(): Gesture | null {
    if (this.open === null) return null;

    const group = this.open;
    this.open = null;

    const notes = [...group.notes].sort((a, b) => a - b);

    return {
      id: this.nextId++,
      notes,
      names: notes.map(midiName),
      chord: nameChord(notes),
      startedAt: group.startedAt,
      endedAt: group.lastNoteOnAt,
    };
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function accidentalName(alter: number): string {
  switch (alter) {
    case -2:
      return 'flat-flat';
    case -1:
      return 'flat';
    case 1:
      return 'sharp';
    case 2:
      return 'double-sharp';
    default:
      throw new Error(`Invalid accidental: ${alter}`);
  }
}

export function chordToMusicXml(
  title: string,
  notes: string[],
  opts?: { octave?: number },
): string {
  let previousPitch = 0;

  const noteXml = notes.map((name, index) => {
    const note = parseSpelled(name);
    const offset = NATURAL_PITCH_CLASSES[note.letter] + note.alter;

    // Keep the written octave tied to the letter, including B# and Cb.
    const octave = index === 0
      ? (opts?.octave ?? 4)
      : Math.floor((previousPitch - offset) / 12);

    previousPitch = (octave + 1) * 12 + offset;

    const alterXml = note.alter === 0
      ? ''
      : `\n          <alter>${note.alter}</alter>`;

    const accidentalXml = note.alter === 0
      ? ''
      : `\n        <accidental>${accidentalName(note.alter)}</accidental>`;

    return `      <note>${index === 0 ? '' : '\n        <chord/>'}
        <pitch>
          <step>${note.letter}</step>${alterXml}
          <octave>${octave}</octave>
        </pitch>
        <duration>4</duration>
        <type>whole</type>${accidentalXml}
      </note>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work>
    <work-title>${escapeXml(title)}</work-title>
  </work>
  <part-list>
    <score-part id="P1">
      <part-name>Piano</part-name>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key>
          <fifths>0</fifths>
        </key>
        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>
        <clef>
          <sign>G</sign>
          <line>2</line>
        </clef>
      </attributes>
${noteXml}
    </measure>
  </part>
</score-partwise>`;
}
