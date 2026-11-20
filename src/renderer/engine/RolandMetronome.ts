// #6530 C (asg 13312): the FP-30X's own metronome over USB MIDI, as an opt-in click for Keep going.
// The address map is UNOFFICIAL (reverse-engineered from Roland's Piano App, github
// aortegaCampanillas/RolandFP30xController) and untested on his piano. Karen's rule: this module
// can write ONLY these four metronome parameters and refuses anything else; no other piano
// setting is ever written. The app's own click stays the default.

/** Roland DT1 (data set 1) to the FP-30X: manufacturer 41, device 10, model 00 00 00 28. */
const DT1_HEADER = [0xf0, 0x41, 0x10, 0x00, 0x00, 0x00, 0x28, 0x12] as const;

/** The only addresses this module will ever write. */
const ADDRESSES = {
  on: [0x01, 0x00, 0x03, 0x1a],
  tempo: [0x01, 0x00, 0x03, 0x09],
  beat: [0x01, 0x00, 0x02, 0x1f],
  volume: [0x01, 0x00, 0x02, 0x21],
} as const;

export type RolandParam = keyof typeof ADDRESSES;

/** Allowed values per parameter (tempo kept to our own 20-240 range, inside Roland's 10-500). */
const RANGE: Record<RolandParam, [number, number]> = { on: [0, 1], tempo: [20, 240], beat: [0, 9], volume: [0, 10] };

/** Roland checksum: the address and data bytes plus it sum to 0 mod 128. */
export function rolandChecksum(bytes: readonly number[]): number {
  return (128 - (bytes.reduce((a, b) => a + b, 0) % 128)) % 128;
}

/** The full SysEx message for one metronome parameter. Throws for any other parameter or a bad value. */
export function rolandMessage(param: RolandParam, value: number): number[] {
  if (!Object.prototype.hasOwnProperty.call(ADDRESSES, param)) throw new Error(`Roland: refusing to write "${String(param)}"`);
  const [lo, hi] = RANGE[param];
  if (!Number.isInteger(value) || value < lo || value > hi) throw new Error(`Roland: ${param} ${value} is outside ${lo}-${hi}`);
  // Tempo is two 7-bit bytes, high first; the rest are one byte.
  const data = param === 'tempo' ? [value >> 7, value & 0x7f] : [value];
  const body = [...ADDRESSES[param], ...data];
  return [...DT1_HEADER, ...body, rolandChecksum(body), 0xf7];
}

/** His piano's USB MIDI output, by name. */
const ROLAND_NAME = /roland|fp-?\d0/i;

/** Lazily asks for SysEx MIDI access on its own (the WebMidi input path stays sysex-free). */
let access: Promise<MIDIAccess> | null = null;
/** The piano's output once found, so the metronome can be switched off synchronously on unload. */
let lastOut: MIDIOutput | null = null;

/**
 * Send metronome settings to the piano, in order. Returns false (and sends nothing) when no
 * Roland output is connected, SysEx access is refused or a value is refused, so the caller
 * falls back to our click.
 */
export async function rolandSend(settings: Partial<Record<RolandParam, number>>): Promise<boolean> {
  try {
    const messages = (Object.keys(settings) as RolandParam[]).map((p) => rolandMessage(p, settings[p] as number));
    access ??= navigator.requestMIDIAccess({ sysex: true });
    const midi = await access;
    const out = [...midi.outputs.values()].find((o) => ROLAND_NAME.test(o.name ?? ''));
    lastOut = out ?? null;
    if (!out) return false;
    for (const m of messages) out.send(m);
    return true;
  } catch (err) {
    access = null;
    console.warn('[roland] metronome send failed:', err);
    return false;
  }
}

/** Metronome off, right now (page unload: no time to await). */
export function rolandOffNow(): void {
  try {
    lastOut?.send(rolandMessage('on', 0));
  } catch {
    /* the piano went away */
  }
}
