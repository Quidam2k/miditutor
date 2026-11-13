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
 * #6047: the miss sound. #11561's -10 dB thud (A2, 110 Hz, 0.18 s) was inaudible on his TV: TV and
 * laptop speakers can't reproduce much under ~150 Hz, and the piano's mid-range masked it. Now a short
 * mid-range knock, a band-passed noise click plus a quick falling tone with nothing under ~250 Hz,
 * so any speaker plays it and it never sounds like a pitch in the music. `db` is the level of the
 * mix at full Miss volume; the slider scales it down from there (missVolumeDb). Constants so tests pin them.
 */
export const MISS_SOUND = {
  db: 0,
  seconds: 0.12,
  noise: { hz: 1800, q: 0.7, db: -4, decay: 0.07 },
  tone: { hz: 520, endHz: 300, db: -8, decay: 0.1 },
  lowCutHz: 250,
} as const;

/** Miss volume is a 0-100 slider; 100 is the loudest the sound goes. */
export const MISS_VOLUME_DEFAULT = 100;

/** Slider percent -> dB under full level (100 -> 0 dB, 50 -> -6 dB); null = muted at 0. */
export function missVolumeDb(percent: number): number | null {
  const p = Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : MISS_VOLUME_DEFAULT));
  return p <= 0 ? null : 20 * Math.log10(p / 100);
}

/** #5799: every wrong note thuds, but keys struck within this of the last thud share it (a chord is one). */
export const MISS_FLOOR_MS = 120;
export const missGateOpen = (lastAt: number, now: number) => now - lastAt >= MISS_FLOOR_MS;

/** The miss voice on whatever audio context is current (live, or Tone.Offline's while measuring). */
function buildMissVoice() {
  const out = new Tone.Volume(MISS_SOUND.db).toDestination();
  const { noise: n, tone: t } = MISS_SOUND;
  const noise = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: n.decay, sustain: 0, release: 0.02 },
    volume: n.db,
  });
  noise.chain(new Tone.Filter({ type: 'bandpass', frequency: n.hz, Q: n.q }), out);
  const tone = new Tone.Synth({
    oscillator: { type: 'square' },
    envelope: { attack: 0.001, decay: t.decay, sustain: 0, release: 0.02 },
    volume: t.db,
  });
  tone.chain(new Tone.Filter({ type: 'highpass', frequency: MISS_SOUND.lowCutHz }), out);
  return {
    fire(at: number, percent: number) {
      const db = missVolumeDb(percent);
      out.mute = db === null;
      if (db !== null) out.volume.value = MISS_SOUND.db + db;
      noise.triggerAttackRelease(n.decay, at);
      tone.triggerAttackRelease(t.hz, t.decay, at);
      tone.frequency.setValueAtTime(t.hz, at);
      tone.frequency.exponentialRampToValueAtTime(t.endHz, at + t.decay);
    },
  };
}

let missVoice: ReturnType<typeof buildMissVoice> | null = null;

/** Plays the miss sound at `percent` of full; returns the audio context's state ('running' means it was heard). */
export async function playMissSound(percent: number = MISS_VOLUME_DEFAULT): Promise<string> {
  try {
    await initAudio();
    const ctx = Tone.getContext();
    if (ctx.state !== 'running') await ctx.resume();
    missVoice ??= buildMissVoice();
    missVoice.fire(Tone.now(), percent);
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
export async function renderMissSound(percent: number = MISS_VOLUME_DEFAULT): Promise<{ sampleRate: number; samples: number[] }> {
  const buffer = await Tone.Offline(() => buildMissVoice().fire(0, percent), 0.4);
  return { sampleRate: buffer.sampleRate, samples: Array.from(buffer.getChannelData(0)) };
}
if (typeof window !== 'undefined') (window as unknown as { __missSoundProbe?: typeof renderMissSound }).__missSoundProbe = renderMissSound;

export function isInitialized(): boolean {
  return initialized;
}
