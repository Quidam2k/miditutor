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
 * #6047: the miss sound. #11561's -10 dB thud (A2, 110 Hz) was inaudible on his TV, so #6047 made it a
 * mid-range knock (a 520 -> 300 Hz tone and a noise click). That was still masked by the piano: 300-500 Hz
 * is where a piano's loudest notes are, and the knock sat at full scale already, so the slider had nowhere to go.
 * #5799 (his words: "it needs to be more obvious, maybe choose a different sound"): three sounds, chosen with
 * Test, two of them outside the piano's main range and short, bright and percussive, in the 2-4 kHz band where
 * the ear is most sensitive and a piano has little energy:
 *   click: a woodblock tock (two inharmonic partials near 2.4 and 3.3 kHz and a band-passed noise tick)
 *   buzz:  two quick square-wave blips near 2.2 kHz
 *   knock: the #6047 mid-range knock, for a TV that plays nothing above it
 * The voice ends in a soft clip (tanh), so Miss volume can go past 100% (up to +6 dB) and saturates instead of cracking.
 * `db` is the level at full (100%) Miss volume. Constants, so tests pin them.
 */
import { MISS_KIND_DEFAULT, type MissKind } from './missKinds';
export { MISS_KINDS, MISS_KIND_DEFAULT, MISS_KIND_LABEL } from './missKinds';
export type { MissKind } from './missKinds';

interface MissTone { hz: number; endHz: number; db: number; decay: number; at: number; type: 'square' | 'sine' | 'triangle' }
interface MissSpec {
  db: number;
  seconds: number;
  /** A band-passed noise tick; null for none. */
  noise: { hz: number; q: number; db: number; decay: number } | null;
  tones: readonly MissTone[];
  /** Nothing below this reaches the output (the tones are high-passed here). */
  lowCutHz: number;
}

export const MISS_SOUNDS: Record<MissKind, MissSpec> = {
  click: {
    db: -3,
    seconds: 0.12,
    noise: { hz: 3200, q: 1.1, db: -2, decay: 0.05 },
    tones: [
      { hz: 2400, endHz: 2300, db: -2, decay: 0.09, at: 0, type: 'square' },
      { hz: 3300, endHz: 3200, db: -5, decay: 0.07, at: 0, type: 'square' },
    ],
    lowCutHz: 1500,
  },
  buzz: {
    db: -6,
    seconds: 0.18,
    noise: null,
    tones: [
      { hz: 2200, endHz: 1900, db: -2, decay: 0.06, at: 0, type: 'square' },
      { hz: 2200, endHz: 1900, db: -2, decay: 0.06, at: 0.1, type: 'square' },
    ],
    lowCutHz: 1200,
  },
  knock: {
    db: 0,
    seconds: 0.12,
    noise: { hz: 1800, q: 0.7, db: -4, decay: 0.07 },
    tones: [{ hz: 520, endHz: 300, db: -8, decay: 0.1, at: 0, type: 'square' }],
    lowCutHz: 250,
  },
};
/** The #6047 knock, kept under its old name. */
export const MISS_SOUND = MISS_SOUNDS.knock;

/** Miss volume is a 0-200 slider: 100 is the sound's own full level, up to 200 (+6 dB, soft-clipped) is headroom past it. */
export const MISS_VOLUME_DEFAULT = 100;
export const MISS_VOLUME_MAX = 200;

/** Slider percent -> dB re full level (100 -> 0 dB, 50 -> -6 dB, 200 -> +6 dB); null = muted at 0. */
export function missVolumeDb(percent: number): number | null {
  const p = Math.min(MISS_VOLUME_MAX, Math.max(0, Number.isFinite(percent) ? percent : MISS_VOLUME_DEFAULT));
  return p <= 0 ? null : 20 * Math.log10(p / 100);
}

/** #5799: every wrong note thuds, but keys struck within this of the last thud share it (a chord is one). */
export const MISS_FLOOR_MS = 120;
export const missGateOpen = (lastAt: number, now: number) => now - lastAt >= MISS_FLOOR_MS;

/** The miss voice on whatever audio context is current (live, or Tone.Offline's while measuring). */
function buildMissVoice(kind: MissKind) {
  const spec = MISS_SOUNDS[kind];
  const out = new Tone.Volume(spec.db);
  // A soft clip as the last stage: nothing can pass full scale, and a hot setting saturates instead of cracking.
  out.chain(new Tone.WaveShaper((x) => Math.tanh(x), 2048), Tone.getDestination());
  const n = spec.noise;
  const noise = n
    ? new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: n.decay, sustain: 0, release: 0.02 },
        volume: n.db,
      })
    : null;
  if (noise && n) noise.chain(new Tone.Filter({ type: 'bandpass', frequency: n.hz, Q: n.q }), out);
  const tones = spec.tones.map((t) => {
    const synth = new Tone.Synth({
      oscillator: { type: t.type },
      envelope: { attack: 0.001, decay: t.decay, sustain: 0, release: 0.02 },
      volume: t.db,
    });
    synth.chain(new Tone.Filter({ type: 'highpass', frequency: spec.lowCutHz }), out);
    return synth;
  });
  return {
    fire(at: number, percent: number) {
      const db = missVolumeDb(percent);
      out.mute = db === null;
      if (db !== null) out.volume.value = spec.db + db;
      if (noise && n) noise.triggerAttackRelease(n.decay, at);
      spec.tones.forEach((t, i) => {
        const synth = tones[i];
        synth.triggerAttackRelease(t.hz, t.decay, at + t.at);
        synth.frequency.setValueAtTime(t.hz, at + t.at);
        synth.frequency.exponentialRampToValueAtTime(t.endHz, at + t.at + t.decay);
      });
    },
  };
}

const missVoices: Partial<Record<MissKind, ReturnType<typeof buildMissVoice>>> = {};

/** Plays the miss sound at `percent` of full; returns the audio context's state ('running' means it was heard). */
export async function playMissSound(percent: number = MISS_VOLUME_DEFAULT, kind: MissKind = MISS_KIND_DEFAULT): Promise<string> {
  try {
    await initAudio();
    const ctx = Tone.getContext();
    if (ctx.state !== 'running') await ctx.resume();
    (missVoices[kind] ??= buildMissVoice(kind)).fire(Tone.now(), percent);
    return ctx.state;
  } catch (err) {
    console.warn('[miss] could not play:', err);
    return 'error';
  }
}

/**
 * Renders the miss sound offline (no speakers) and returns its mono samples, so scripts/measure_miss_sound.py
 * can measure peak, RMS and spectrum of the real graph. Also on window.__missSoundProbe in the renderer.
 */
export async function renderMissSound(
  percent: number = MISS_VOLUME_DEFAULT,
  kind: MissKind = MISS_KIND_DEFAULT,
): Promise<{ sampleRate: number; samples: number[] }> {
  const buffer = await Tone.Offline(() => buildMissVoice(kind).fire(0, percent), 0.4);
  return { sampleRate: buffer.sampleRate, samples: Array.from(buffer.getChannelData(0)) };
}
if (typeof window !== 'undefined') (window as unknown as { __missSoundProbe?: typeof renderMissSound }).__missSoundProbe = renderMissSound;

export function isInitialized(): boolean {
  return initialized;
}
