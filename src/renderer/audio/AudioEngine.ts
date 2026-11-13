import * as Tone from 'tone';

let synth: Tone.PolySynth | null = null;
let initialized = false;

/**
 * Must be called from a user gesture (click/keypress) to satisfy browser autoplay policy.
 */
export async function initAudio(): Promise<void> {
  if (initialized) return;
  await Tone.start();
  synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.02, decay: 0.3, sustain: 0.2, release: 0.8 },
    volume: -8,
  }).toDestination();
  initialized = true;
}

/**
 * Convert MIDI number to Tone.js note string (e.g., 60 → "C4")
 */
function midiToToneNote(midiNumber: number): string {
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(midiNumber / 12) - 1;
  const note = noteNames[midiNumber % 12];
  return `${note}${octave}`;
}

/**
 * Play a single note
 */
export function playNote(midiNumber: number, duration = '8n'): void {
  if (!synth || !initialized) return;
  const note = midiToToneNote(midiNumber);
  synth.triggerAttackRelease(note, duration);
}

/**
 * Play multiple notes simultaneously (chord)
 */
export function playChord(midiNumbers: number[], duration: string | number = '4n'): void {
  if (!synth || !initialized) return;
  const notes = midiNumbers.map(midiToToneNote);
  synth.triggerAttackRelease(notes, duration);
}

/**
 * #5382: a soft two-note chime (G5 then C6) for "you're done", heard with his eyes on
 * the keys. Opens audio if it isn't yet; stays quiet if the browser won't allow it.
 */
export async function playChime(): Promise<void> {
  try {
    await initAudio();
    if (!synth) return;
    const now = Tone.now();
    synth.triggerAttackRelease('G5', '8n', now, 0.35);
    synth.triggerAttackRelease('C6', '4n', now + 0.18, 0.35);
  } catch (err) {
    console.warn('[chime] could not play:', err);
  }
}

/** #5521: one soft high "ding" for a clean lap, so he knows without looking. */
export async function playLapChime(): Promise<void> {
  try {
    await initAudio();
    synth?.triggerAttackRelease('E6', '16n', Tone.now(), 0.25);
  } catch (err) {
    console.warn('[chime] could not play:', err);
  }
}

/**
 * #5521: the finale when a backwards build reaches its target, scaled to its size:
 * small = the #5382 chime, medium = a rising arpeggio, big = a longer run and a chord.
 */
export async function playFanfare(size: 'small' | 'medium' | 'big'): Promise<void> {
  if (size === 'small') return playChime();
  try {
    await initAudio();
    if (!synth) return;
    const now = Tone.now();
    const run = size === 'medium' ? ['C5', 'E5', 'G5', 'C6'] : ['C5', 'E5', 'G5', 'C6', 'E6', 'G6'];
    run.forEach((n, i) => synth?.triggerAttackRelease(n, '16n', now + i * 0.11, 0.35));
    if (size === 'big') synth.triggerAttackRelease(['C5', 'E5', 'G5', 'C6'], '2n', now + run.length * 0.11 + 0.05, 0.4);
  } catch (err) {
    console.warn('[chime] could not play:', err);
  }
}

/**
 * #11561: the miss sound. #5566's tick (70 ms of pink noise at -30 dB, 22 dB under the notes
 * at -8 dB) was too quiet to hear at the piano. Now a short low thud, a dropping drum hit
 * rather than a held pitch, so it never sounds like part of the music; about as loud as a
 * played note at mp (not startling). The level is a constant so a test can pin it.
 */
export const MISS_SOUND = { db: -10, note: 'A2', seconds: 0.18 } as const;

/** #5799: every wrong note thuds, but keys struck within this of the last thud share it (a chord is one). */
export const MISS_FLOOR_MS = 120;
export const missGateOpen = (lastAt: number, now: number) => now - lastAt >= MISS_FLOOR_MS;

let missThud: Tone.MembraneSynth | null = null;

/** Plays the miss thud; returns the audio context's state ('running' means it was heard). */
export async function playMissSound(): Promise<string> {
  try {
    await initAudio();
    const ctx = Tone.getContext();
    if (ctx.state !== 'running') await ctx.resume();
    missThud ??= new Tone.MembraneSynth({
      pitchDecay: 0.03,
      octaves: 2,
      envelope: { attack: 0.002, decay: MISS_SOUND.seconds, sustain: 0, release: 0.05 },
      volume: MISS_SOUND.db,
    }).toDestination();
    missThud.triggerAttackRelease(MISS_SOUND.note, MISS_SOUND.seconds, Tone.now());
    return ctx.state;
  } catch (err) {
    console.warn('[miss] could not play:', err);
    return 'error';
  }
}

export function isInitialized(): boolean {
  return initialized;
}
