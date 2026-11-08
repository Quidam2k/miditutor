// #11354: Choose fresh melodies and render them in the practice key.

export type Mode = 'major' | 'minor';

export interface FreshTune {
  id: string;
  title: string;
  mode: Mode;
  meter: string;
  /** Eighths in a pickup (short first) bar; 0 or absent when the tune starts on a full bar. */
  pickup?: number;
  notes: [number | null, number, number, number?][];
}

export const FRESH_KEYS: { name: string; mode: Mode }[] = [
  { name: 'C', mode: 'major' },
  { name: 'G', mode: 'major' },
  { name: 'D', mode: 'major' },
  { name: 'A', mode: 'major' },
  { name: 'E', mode: 'major' },
  { name: 'F', mode: 'major' },
  { name: 'Bb', mode: 'major' },
  { name: 'Eb', mode: 'major' },
  { name: 'Ab', mode: 'major' },
  { name: 'a', mode: 'minor' },
  { name: 'e', mode: 'minor' },
  { name: 'b', mode: 'minor' },
  { name: 'd', mode: 'minor' },
  { name: 'g', mode: 'minor' },
  { name: 'c', mode: 'minor' },
];

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const PITCH_CLASSES: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};
const NATURAL_FIFTHS: Record<string, number> = {
  C: 0, D: 2, E: 4, F: -1, G: 1, A: 3, B: 5,
};
const BAR_LENGTHS: Record<string, number> = {
  '2/4': 4, '3/4': 6, '4/4': 8, '6/8': 6,
};
const DURATIONS = [8, 6, 4, 3, 2, 1];
const TYPES: Record<number, string> = {
  1: 'eighth', 2: 'quarter', 3: 'quarter',
  4: 'half', 6: 'half', 8: 'whole',
};
const ACCIDENTALS: Record<number, string> = {
  [-2]: 'flat-flat',
  [-1]: 'flat',
  0: 'natural',
  1: 'sharp',
  2: 'double-sharp',
};

/** Key signature fifths for a key name like "Bb" or "f#" (lower-case = minor). */
export function keyFifths(name: string): number {
  const match = /^([A-Ga-g])([#b]?)$/.exec(name);
  if (!match) throw new Error(`Invalid key name: ${name}`);

  const tonic = match[1]!;
  const accidental = match[2]!;
  const minor = tonic === tonic.toLowerCase();
  return NATURAL_FIFTHS[tonic.toUpperCase()]!
    - (minor ? 3 : 0)
    + (accidental === '#' ? 7 : accidental === 'b' ? -7 : 0);
}

/** Tunes of that mode not in `seen`; null when none left. */
export function pickFreshTune(
  tunes: FreshTune[],
  mode: Mode,
  seen: ReadonlySet<string>,
  rand: () => number = Math.random,
): FreshTune | null {
  const available = tunes.filter(t => t.mode === mode && !seen.has(t.id));
  if (available.length === 0) return null;
  return available[Math.floor(rand() * available.length)] ?? null;
}

/** Escape text embedded in MusicXML. */
function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** MusicXML 3.1 for the tune in `keyName`, on one treble staff. */
export function freshTuneXml(
  t: FreshTune,
  keyName: string,
  label: string,
): string {
  const fifths = keyFifths(keyName);
  const tonicIdx = LETTERS.indexOf(keyName.charAt(0).toUpperCase());
  const barLength = BAR_LENGTHS[t.meter];
  if (barLength === undefined) throw new Error(`Unsupported meter: ${t.meter}`);

  const [beats, beatType] = t.meter.split('/');
  const signature: Record<string, number> = {
    C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0,
  };
  const order = fifths >= 0
    ? ['F', 'C', 'G', 'D', 'A', 'E', 'B']
    : ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
  for (let i = 0; i < Math.abs(fifths); i += 1) {
    const letter = order[i % 7]!;
    signature[letter] = signature[letter]! + (fifths >= 0 ? 1 : -1);
  }

  for (const [degree, delta, eighths] of t.notes) {
    if (
      (degree !== null && !Number.isInteger(degree))
      || !Number.isInteger(delta)
      || !Number.isSafeInteger(eighths)
      || eighths <= 0
    ) {
      throw new Error('Invalid fresh-tune note');
    }
  }

  const pitchAt = (degree: number, delta: number, baseOct: number) => {
    const position = tonicIdx + degree;
    const step = LETTERS[((position % 7) + 7) % 7]!;
    const octave = baseOct + Math.floor(position / 7);
    const alter = signature[step]! + delta;
    return {
      step,
      octave,
      alter,
      midi: 12 * (octave + 1) + PITCH_CLASSES[step]! + alter,
    };
  };

  let baseOct = 4;
  let bestDistance = Infinity;
  const pitched = t.notes.filter(entry => entry[0] !== null);
  if (pitched.length > 0) {
    let found = false;
    for (const candidate of [3, 4, 5]) {
      let low = Infinity;
      let high = -Infinity;
      for (const [degree, delta] of pitched) {
        const midi = pitchAt(degree!, delta, candidate).midi;
        low = Math.min(low, midi);
        high = Math.max(high, midi);
      }
      const distance = Math.abs((low + high) / 2 - 71);
      if (low >= 57 && distance < bestDistance) {
        baseOct = candidate;
        bestDistance = distance;
        found = true;
      }
    }
    if (!found) throw new Error('Tune cannot fit above MIDI 56 in octaves 3–5');
  }

  const measures: string[][] = [];
  let measureNotes: string[] = [];
  let used = 0;
  let incomingTie = false;
  // Within a bar an accidental holds for that line or space: print one whenever the sound differs.
  let barAlters = new Map<string, number>();

  for (const [degree, delta, eighths, sourceTie] of t.notes) {
    const isRest = degree === null;
    let remaining = eighths;
    let firstPiece = true;

    while (remaining > 0) {
      const thisBar = measures.length === 0 && t.pickup ? t.pickup : barLength;
      const room = Math.min(remaining, thisBar - used);
      const duration = DURATIONS.find(value => value <= room)!;
      remaining -= duration;

      const stop = !isRest && (incomingTie || !firstPiece);
      const start = !isRest && (remaining > 0 || sourceTie === 1);
      const ties = `${stop ? '<tie type="stop"/>' : ''}`
        + `${start ? '<tie type="start"/>' : ''}`;
      const notations = stop || start
        ? '<notations>'
          + `${stop ? '<tied type="stop"/>' : ''}`
          + `${start ? '<tied type="start"/>' : ''}`
          + '</notations>'
        : '';

      let body = '<rest/>';
      let accidental = '';
      if (degree !== null) {
        const p = pitchAt(degree, delta, baseOct);
        body = `<pitch><step>${p.step}</step>`
          + `${p.alter !== 0 ? `<alter>${p.alter}</alter>` : ''}`
          + `<octave>${p.octave}</octave></pitch>`;
        const where = `${p.step}${p.octave}`;
        const shown = barAlters.get(where) ?? signature[p.step]!;
        barAlters.set(where, p.alter);
        // A tied continuation never repeats its accidental.
        if (p.alter !== shown && !stop) {
          const name = ACCIDENTALS[p.alter];
          if (name === undefined) {
            throw new Error(`Unsupported accidental: ${p.alter}`);
          }
          accidental = `<accidental>${name}</accidental>`;
        }
      }

      measureNotes.push(
        `<note>${body}<duration>${duration}</duration>${ties}`
        + `<type>${TYPES[duration]!}</type>`
        + `${duration === 3 || duration === 6 ? '<dot/>' : ''}`
        + `${accidental}${notations}</note>`,
      );
      used += duration;
      firstPiece = false;

      if (used === thisBar) {
        measures.push(measureNotes);
        measureNotes = [];
        used = 0;
        barAlters = new Map();
      }
    }
    incomingTie = !isRest && sourceTie === 1;
  }

  if (measureNotes.length > 0 || measures.length === 0) {
    measures.push(measureNotes);
  }

  const attributes = '<attributes><divisions>2</divisions>'
    + `<key><fifths>${fifths}</fifths><mode>${t.mode}</mode></key>`
    + `<time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>`
    + '<staves>1</staves><clef><sign>G</sign><line>2</line></clef>'
    + '</attributes>';

  const xmlMeasures = measures.map((notes, index) =>
    `<measure number="${index + 1}">`
    + `${index === 0 ? attributes : ''}`
    + notes.join('')
    + (index === measures.length - 1
      ? '<barline location="right"><bar-style>light-heavy</bar-style></barline>'
      : '')
    + '</measure>',
  ).join('');

  return '<?xml version="1.0" encoding="UTF-8"?>'
    + '<score-partwise version="3.1">'
    + `<work><work-title>${escapeXml(label)}</work-title></work>`
    + '<part-list><score-part id="P1"><part-name>Melody</part-name>'
    + '</score-part></part-list>'
    + `<part id="P1">${xmlMeasures}</part></score-partwise>`;
}

