// Piano audio for a recorded take (#9574): his MIDI rendered with the Salamander
// Grand samples (CC-BY 3.0, Alexander Holm), one sample every minor third,
// pitch-shifted to the nearest note. Raw OfflineAudioContext, not Tone.js: the
// render runs natively off the JS thread, so a long take never freezes the UI.
const SAMPLE_URLS = import.meta.glob('../assets/salamander/*.mp3', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

import type { TakeEvent } from '../../main/recorder';

export interface Voice {
  note: number;
  velocity: number;
  start: number;
  end: number;
}

export function sampleNote(fileName: string): number | null {
  const name = fileName.split(/[\\/]/).pop() ?? '';
  const match = /^([A-G])(s?)(-?\d+)(?:\.mp3)?$/.exec(name);
  if (!match) return null;
  const offsets: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const pitch = offsets[match[1] ?? ''];
  if (pitch === undefined) return null;
  const note = (Number(match[3]) + 1) * 12 + pitch + (match[2] ? 1 : 0);
  return Number.isInteger(note) && note >= 0 && note <= 127 ? note : null;
}

export function voicesFromEvents(events: TakeEvent[], durationSec: number): Voice[] {
  const voices: Voice[] = [];
  const active = new Map<number, { voice: Voice; held: boolean }>();
  let pedalDown = false;

  for (const event of [...events].sort((a, b) => a.t - b.t)) {
    const time = Math.max(0, event.t / 1000);
    if (time >= durationSec) break;
    if (event.kind === 'pedal') {
      pedalDown = event.down;
      if (!pedalDown) {
        for (const [note, state] of active) {
          if (!state.held) {
            state.voice.end = time;
            active.delete(note);
          }
        }
      }
      continue;
    }

    const previous = active.get(event.note);
    if (event.kind === 'noteon' && event.velocity > 0) {
      if (previous) previous.voice.end = time;
      const voice: Voice = {
        note: event.note, velocity: event.velocity, start: time, end: durationSec
      };
      voices.push(voice);
      active.set(event.note, { voice, held: true });
    } else if (previous) {
      previous.held = false;
      if (!pedalDown) {
        previous.voice.end = time;
        active.delete(event.note);
      }
    }
  }
  return voices.sort((a, b) => a.start - b.start);
}

export function nearestSample(
  note: number,
  sampleNotes: number[]
): { sample: number; rate: number } {
  let sample = sampleNotes[0];
  if (sample === undefined) throw new Error('No piano samples are available.');
  for (const candidate of sampleNotes) {
    const distance = Math.abs(note - candidate);
    const bestDistance = Math.abs(note - sample);
    if (distance < bestDistance || (distance === bestDistance && candidate < sample)) {
      sample = candidate;
    }
  }
  return { sample, rate: 2 ** ((note - sample) / 12) };
}

export function velocityGain(velocity: number): number {
  return (Math.max(0, Math.min(127, velocity)) / 127) ** 1.6 * 0.9;
}

type Sample = { buffer: AudioBuffer; leadIn: number };

// Seconds of near-silence before the hammer: mp3 encoder delay plus the
// recording's own gap. Skipped so the note sounds exactly at its time.
export function leadIn(data: Float32Array, sampleRate: number, floor = 0.01): number {
  const first = data.findIndex((x) => Math.abs(x) > floor);
  return first < 0 ? 0 : first / sampleRate;
}

let sampleCache: Promise<Map<number, Sample>> | undefined;

function loadSamples(): Promise<Map<number, Sample>> {
  if (!sampleCache) {
    sampleCache = (async () => {
      const decoder = new OfflineAudioContext(2, 1, 44100);
      const entries = await Promise.all(Object.entries(SAMPLE_URLS).map(async ([file, url]) => {
        const note = sampleNote(file);
        if (note === null) throw new Error(`Invalid piano sample name: ${file}`);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to load piano sample: ${file}`);
        const buffer = await decoder.decodeAudioData(await response.arrayBuffer());
        return [note, { buffer, leadIn: leadIn(buffer.getChannelData(0), buffer.sampleRate) }] as const;
      }));
      return new Map(entries);
    })().catch((error: unknown) => {
      // Failed loads must not prevent a later retry.
      sampleCache = undefined;
      throw error;
    });
  }
  return sampleCache;
}

export async function renderTake(
  events: TakeEvent[],
  durationMs: number,
): Promise<AudioBuffer> {
  const sampleRate = 44100;
  const samples = await loadSamples();
  const durationSec = Math.max(0, durationMs / 1000);
  const frames = Math.max(1, Math.ceil(durationSec * sampleRate));
  const ctx = new OfflineAudioContext(2, frames, sampleRate);
  const master = ctx.createGain();
  const compressor = ctx.createDynamicsCompressor();
  master.gain.value = 0.8;
  compressor.threshold.value = -10;
  compressor.ratio.value = 4;
  master.connect(compressor).connect(ctx.destination);
  const sampleNotes = [...samples.keys()];

  for (const voice of voicesFromEvents(events, durationSec)) {
    const { sample, rate } = nearestSample(voice.note, sampleNotes);
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    const { buffer, leadIn: skip } = samples.get(sample)!;
    source.buffer = buffer;
    source.playbackRate.value = rate;
    gain.gain.setValueAtTime(velocityGain(voice.velocity), voice.start);
    gain.gain.setTargetAtTime(0, voice.end, 0.08);
    source.connect(gain).connect(master);
    source.start(voice.start, skip);
    source.stop(voice.end + 0.6);
  }
  return await ctx.startRendering();
}

export async function* pcmChunks(buffer: AudioBuffer): AsyncGenerator<Int16Array> {
  const chunkFrames = Math.max(1, Math.floor(5 * buffer.sampleRate));   // 5 s
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  // Peak-normalise to -1 dBFS (at most 8x): a single soft line otherwise plays
  // back at -25 dBFS. Measured chunk by chunk so a long take never blocks.
  let peak = 0;
  for (let offset = 0; offset < buffer.length; offset += chunkFrames) {
    const end = Math.min(buffer.length, offset + chunkFrames);
    for (const channel of channels) {
      for (let i = offset; i < end; i++) peak = Math.max(peak, Math.abs(channel[i]!));
    }
    await pause();
  }
  const gain = peak > 0 ? Math.min(8, 0.89 / peak) : 1;
  for (let offset = 0; offset < buffer.length; offset += chunkFrames) {
    const frames = Math.min(chunkFrames, buffer.length - offset);
    const chunk = new Int16Array(frames * channels.length);
    let index = 0;
    for (let frame = 0; frame < frames; frame++) {
      for (const channel of channels) {
        chunk[index++] = Math.round(Math.max(-1, Math.min(1, channel[offset + frame]! * gain)) * 32767);
      }
    }
    yield chunk;
    await pause();
  }
}
