import { describe, it, expect } from 'vitest';
import {
  parseSpelled,
  spelledToString,
  pitchClass,
  midiName,
  nameChord,
  checkChord,
  GestureTracker,
  chordToMusicXml,
} from '../src/shared/music';

describe('spelled notes', () => {
  it.each([
    ['C', 'C', 0],
    ['F#', 'F', 1],
    ['Bb', 'B', -1],
    ['Ebb', 'E', -2],
    ['C##', 'C', 2],
    ['E flat', 'E', -1],
    ['F sharp', 'F', 1],
    ['B double flat', 'B', -2],
    ['C double sharp', 'C', 2],
    ['  f#  ', 'F', 1],
  ] as const)('parses %s', (input, letter, alter) => {
    expect(parseSpelled(input)).toEqual({ letter, alter });
  });

  it.each(['', 'H', 'C###', 'Dbbb', 'C#b', 'C4', 'C nonsense'])(
    'rejects %j',
    (input) => {
      expect(() => parseSpelled(input)).toThrow(Error);
    },
  );

  it('formats accidentals and wraps pitch classes', () => {
    expect(spelledToString(parseSpelled('F sharp'))).toBe('F#');
    expect(spelledToString(parseSpelled('B flat'))).toBe('Bb');
    expect(spelledToString(parseSpelled('C'))).toBe('C');
    expect(spelledToString(parseSpelled('E double flat'))).toBe('Ebb');
    expect(spelledToString(parseSpelled('F double sharp'))).toBe('F##');
    expect(pitchClass(parseSpelled('B#'))).toBe(0);
    expect(pitchClass(parseSpelled('Cb'))).toBe(11);
  });

  it('names MIDI notes with sharps and C4 = 60', () => {
    expect(midiName(61)).toBe('C#4');
    expect(midiName(60)).toBe('C4');
    expect(midiName(58)).toBe('A#3');
  });
});

describe('nameChord', () => {
  it('recognizes C major in root position and dedupes pitch classes', () => {
    expect(nameChord([72, 67, 60, 64, 60])).toEqual({
      name: 'C major',
      root: 'C',
      quality: 'major',
      inversion: 0,
      bass: 'C4',
    });
  });

  it('recognizes C major in first inversion', () => {
    expect(nameChord([72, 64, 67])).toMatchObject({
      name: 'C major',
      inversion: 1,
      bass: 'E4',
    });
  });

  it('recognizes C major in second inversion', () => {
    expect(nameChord([76, 72, 67])).toMatchObject({
      name: 'C major',
      inversion: 2,
      bass: 'G4',
    });
  });

  it('recognizes A minor', () => {
    expect(nameChord([57, 60, 64])?.name).toBe('A minor');
  });

  it('recognizes G7', () => {
    expect(nameChord([55, 59, 62, 65])).toMatchObject({
      name: 'G7',
      inversion: 0,
      bass: 'G3',
    });
  });

  it('recognizes B diminished', () => {
    expect(nameChord([59, 62, 65])?.name).toBe('B diminished');
  });

  it('uses Eb for an Eb major root', () => {
    expect(nameChord([63, 67, 70])).toMatchObject({
      name: 'Eb major',
      root: 'Eb',
      bass: 'D#4',
    });
  });

  it('recognizes the other seventh qualities', () => {
    expect(nameChord([60, 64, 67, 71])?.name).toBe('Cmaj7');
    expect(nameChord([57, 60, 64, 67])?.name).toBe('Am7');
    expect(nameChord([59, 62, 65, 69])?.name).toBe('Bm7b5');
    expect(nameChord([59, 62, 65, 68])?.name).toBe('Bdim7');
  });

  it('uses the bass as root for symmetric chords', () => {
    expect(nameChord([64, 68, 72])).toMatchObject({
      name: 'E augmented',
      inversion: 0,
    });
    expect(nameChord([62, 65, 68, 71])).toMatchObject({
      name: 'Ddim7',
      inversion: 0,
    });
  });

  it('returns null for dyads and unknown sets', () => {
    expect(nameChord([])).toBeNull();
    expect(nameChord([60, 72])).toBeNull();
    expect(nameChord([60, 64])).toBeNull();
    expect(nameChord([60, 61, 62])).toBeNull();
  });
});

describe('checkChord', () => {
  it('compares pitch classes across octaves', () => {
    expect(checkChord(['C', 'E', 'G'], [48, 76, 79, 60])).toEqual({
      verdict: 'correct',
      missing: [],
      extra: [],
    });
  });

  it('reports a non-empty subset as incomplete', () => {
    expect(checkChord(['E flat', 'G', 'B flat'], [63, 67])).toEqual({
      verdict: 'incomplete',
      missing: ['Bb'],
      extra: [],
    });
  });

  it('reports extra notes as wrong', () => {
    expect(checkChord(['C', 'E', 'G'], [60, 64, 67, 61])).toEqual({
      verdict: 'wrong',
      missing: [],
      extra: ['C#4'],
    });
  });

  it('reports empty played notes as wrong', () => {
    expect(checkChord(['C'], [])).toEqual({
      verdict: 'wrong',
      missing: ['C'],
      extra: [],
    });
    expect(checkChord([], []).verdict).toBe('wrong');
  });
});

describe('GestureTracker', () => {
  it('groups three notes within 50ms', () => {
    const tracker = new GestureTracker();

    tracker.noteOn(67, 0);
    tracker.noteOn(60, 25);
    tracker.noteOn(64, 50);
    tracker.noteOff(60, 60);

    expect(tracker.tick(169)).toBeNull();
    expect(tracker.tick(170)).toEqual({
      id: 1,
      notes: [60, 64, 67],
      names: ['C4', 'E4', 'G4'],
      chord: nameChord([60, 64, 67]),
      startedAt: 0,
      endedAt: 50,
    });
    expect(tracker.tick(200)).toBeNull();
  });

  it('forms two gestures for notes 300ms apart and increases ids', () => {
    const tracker = new GestureTracker();

    tracker.noteOn(60, 0);
    const first = tracker.tick(120);

    tracker.noteOn(64, 300);
    const second = tracker.tick(420);

    expect(first).toMatchObject({ id: 1, notes: [60] });
    expect(second).toMatchObject({ id: 2, notes: [64] });
  });

  it('extends an open group, dedupes notes, and force-closes on flush', () => {
    const tracker = new GestureTracker({ windowMs: 50 });

    tracker.noteOn(60, 0);
    tracker.noteOn(60, 40);

    expect(tracker.tick(50)).toBeNull();
    expect(tracker.flush(60)).toMatchObject({
      notes: [60],
      startedAt: 0,
      endedAt: 40,
    });
    expect(tracker.flush(70)).toBeNull();
  });
});

describe('chordToMusicXml', () => {
  it('writes an Eb major whole-note chord', () => {
    const xml = chordToMusicXml('Eb major', ['Eb', 'G', 'Bb']);

    expect(xml.match(/<note>/g)).toHaveLength(3);
    expect(xml.match(/<chord\/>/g)).toHaveLength(2);
    expect(xml).toContain('<alter>-1</alter>');
    expect(xml.match(/<accidental>flat<\/accidental>/g)).toHaveLength(2);
    expect(xml.match(/<octave>4<\/octave>/g)).toHaveLength(3);
    expect(xml).toContain('<work-title>Eb major</work-title>');
    expect(xml).toContain('<score-partwise version="3.1">');
  });

  it('stacks notes upward from the requested octave', () => {
    const xml = chordToMusicXml('Inversion', ['G', 'C', 'E'], { octave: 3 });

    expect([...xml.matchAll(/<octave>(-?\d+)<\/octave>/g)].map(
      (match) => Number(match[1]),
    )).toEqual([3, 4, 4]);
  });

  it('preserves written octaves for B# and Cb', () => {
    const xml = chordToMusicXml('Enharmonics', ['Cb', 'B#', 'C']);

    expect([...xml.matchAll(/<octave>(-?\d+)<\/octave>/g)].map(
      (match) => Number(match[1]),
    )).toEqual([4, 3, 5]);
    expect(xml).toContain('<step>B</step>\n          <alter>1</alter>\n          <octave>3</octave>');
  });

  it('escapes titles and writes double accidentals', () => {
    const xml = chordToMusicXml('A & <B> "C" \'D\'', ['C##', 'Ebb']);

    expect(xml).toContain(
      '<work-title>A &amp; &lt;B&gt; &quot;C&quot; &apos;D&apos;</work-title>',
    );
    expect(xml).toContain('<accidental>double-sharp</accidental>');
    expect(xml).toContain('<accidental>flat-flat</accidental>');
  });
});
