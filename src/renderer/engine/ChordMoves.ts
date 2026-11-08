// #11354 item 6 (JP 10/23, Sorcerer's Apprentice: "spot the patterns between the chords. Who's moving
// where? Who stays the same? Is there a bigger pattern across multiple chords?"). From one chord of a
// hand to its next: which keys stay, which move and how far, and whether the move repeats. Pure logic.
import type { BlockStep } from './Blocking';
import type { Hand } from './HandZones';

/** stay: the same key is in both chords. move: by = keys up (+) or down (-). new: an extra note. */
export interface ChordVoice { midi: number; kind: 'stay' | 'move' | 'new'; by: number }

export interface ChordChange {
  hand: Hand;
  step: number;
  bar: number;
  fromStep: number;
  voices: ChordVoice[];
  /** Every note moved the same distance: the whole hand shifts. */
  shift: number | null;
  /** The same move as this hand's last change: a pattern across chords. */
  same: boolean;
}

/** Chords further apart than this many bars aren't compared. */
export const CHORD_GAP_BARS = 1;

const chordOf = (s: BlockStep, hand: Hand): number[] =>
  [...new Set(s.notes.filter((n) => n.hand === hand).map((n) => n.midi))].sort((a, b) => a - b);

function voices(from: number[], to: number[]): ChordVoice[] {
  const kept = new Set(from.filter((m) => to.includes(m)));
  const left = from.filter((m) => !kept.has(m));
  const arriving = to.filter((m) => !kept.has(m));
  return to.map((midi) => {
    if (kept.has(midi)) return { midi, kind: 'stay', by: 0 };
    if (!left.length) return { midi, kind: 'new', by: 0 };
    // Same count: voice by voice, bottom to top. Otherwise from the nearest key that left.
    const i = arriving.indexOf(midi);
    const src = left.length === arriving.length
      ? left[i]
      : left.reduce((best, m) => (Math.abs(m - midi) < Math.abs(best - midi) ? m : best), left[0]);
    return { midi, kind: 'move', by: midi - src };
  });
}

const signature = (vs: ChordVoice[]) => vs.map((v) => `${v.kind[0]}${v.by}`).join(',');

export function chordChanges(steps: BlockStep[], hand: Hand): ChordChange[] {
  const out: ChordChange[] = [];
  let prev: { step: number; bar: number; keys: number[] } | null = null;
  let lastSig: string | null = null;
  for (const s of steps) {
    const keys = chordOf(s, hand);
    if (keys.length < 2) continue;
    if (prev && s.bar - prev.bar <= CHORD_GAP_BARS) {
      const vs = voices(prev.keys, keys);
      // The same chord again teaches nothing about movement, and doesn't break a pattern either.
      if (vs.some((v) => v.kind !== 'stay')) {
        const sig = signature(vs);
        const bys = vs.map((v) => v.by);
        const shift = prev.keys.length === keys.length && vs.every((v) => v.kind === 'move') && bys.every((b) => b === bys[0])
          ? bys[0]
          : null;
        out.push({ hand, step: s.step, bar: s.bar, fromStep: prev.step, voices: vs, shift, same: sig === lastSig });
        lastSig = sig;
      }
    } else lastSig = null;
    prev = { step: s.step, bar: s.bar, keys };
  }
  return out;
}

/** "+2", "-1": keys up or down. */
export const movedBy = (by: number) => (by > 0 ? `+${by}` : `${by}`);
