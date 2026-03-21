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
export function playChord(midiNumbers: number[], duration = '4n'): void {
  if (!synth || !initialized) return;
  const notes = midiNumbers.map(midiToToneNote);
  synth.triggerAttackRelease(notes, duration);
}

/**
 * Play a short success sound
 */
export function playCorrectSound(): void {
  if (!synth || !initialized) return;
  const now = Tone.now();
  synth.triggerAttackRelease('C5', '16n', now);
  synth.triggerAttackRelease('E5', '16n', now + 0.08);
  synth.triggerAttackRelease('G5', '16n', now + 0.16);
}

/**
 * Play a short error sound
 */
export function playWrongSound(): void {
  if (!synth || !initialized) return;
  const now = Tone.now();
  synth.triggerAttackRelease('E3', '16n', now);
  synth.triggerAttackRelease('Eb3', '16n', now + 0.1);
}

export function isInitialized(): boolean {
  return initialized;
}
