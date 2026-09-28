import { useEffect, useRef, useState } from 'react';
import { useMidiStore } from '../../store/useMidiStore';
import { midiNumberToPitch, pitchToDisplayName } from '../../engine/MusicTheory';

// DEV-ONLY input source. Lets you exercise the MIDI monitor, the exercise
// engine and the score follower from the computer keyboard (or mouse) when no
// hardware / loopMIDI is attached. Routes through the store's ingestNote — the
// exact same path the real keyboard uses. Gate its render behind import.meta.env.DEV.

// Tracker-style two-row layout. Offsets are semitones above C of the base octave:
// bottom row (Z…M ,) = base octave, top row (Q…P) = base octave + 1 and a bit.
const KEY_OFFSETS: { key: string; offset: number }[] = [
  { key: 'z', offset: 0 }, { key: 's', offset: 1 }, { key: 'x', offset: 2 },
  { key: 'd', offset: 3 }, { key: 'c', offset: 4 }, { key: 'v', offset: 5 },
  { key: 'g', offset: 6 }, { key: 'b', offset: 7 }, { key: 'h', offset: 8 },
  { key: 'n', offset: 9 }, { key: 'j', offset: 10 }, { key: 'm', offset: 11 },
  { key: 'q', offset: 12 }, { key: '2', offset: 13 }, { key: 'w', offset: 14 },
  { key: '3', offset: 15 }, { key: 'e', offset: 16 }, { key: 'r', offset: 17 },
  { key: '5', offset: 18 }, { key: 't', offset: 19 }, { key: '6', offset: 20 },
  { key: 'y', offset: 21 }, { key: '7', offset: 22 }, { key: 'u', offset: 23 },
  { key: 'i', offset: 24 }, { key: '9', offset: 25 }, { key: 'o', offset: 26 },
  { key: '0', offset: 27 }, { key: 'p', offset: 28 },
];
const BLACK = new Set([1, 3, 6, 8, 10]);

const VELOCITY = 100;
const MIN_OCTAVE = 1;
const MAX_OCTAVE = 6;

declare global {
  interface Window {
    // Dev-only test hook: play a note (or chord) through the real ingest path.
    __miditutorDev?: { play: (notes: number | number[], holdMs?: number) => void };
  }
}

export function VirtualKeyboardDev() {
  const ingestNote = useMidiStore((s) => s.ingestNote);
  const [held, setHeld] = useState<Set<number>>(new Set());
  const heldRef = useRef<Set<number>>(new Set());
  // Base octave for the bottom row; C3 by default so the pair of rows spans C3–E5.
  const [octave, setOctave] = useState(3);
  const octaveRef = useRef(octave);
  octaveRef.current = octave;
  // Remember which note each physical key started, so an octave shift while a
  // key is down still releases the right note.
  const keyNoteRef = useRef<Map<string, number>>(new Map());

  const baseNote = (oct: number) => (oct + 1) * 12;

  const press = (note: number) => {
    if (heldRef.current.has(note)) return; // ignore auto-repeat / double-fire
    heldRef.current.add(note);
    setHeld(new Set(heldRef.current));
    ingestNote({ kind: 'noteon', note, velocity: VELOCITY, channel: 1, source: 'virtual' });
  };

  const release = (note: number) => {
    if (!heldRef.current.has(note)) return;
    heldRef.current.delete(note);
    setHeld(new Set(heldRef.current));
    ingestNote({ kind: 'noteoff', note, velocity: 0, channel: 1, source: 'virtual' });
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === '-' || k === '=') {
        e.preventDefault();
        setOctave((o) => Math.min(MAX_OCTAVE, Math.max(MIN_OCTAVE, o + (k === '=' ? 1 : -1))));
        return;
      }
      const entry = KEY_OFFSETS.find((x) => x.key === k);
      if (entry) {
        e.preventDefault();
        const note = baseNote(octaveRef.current) + entry.offset;
        keyNoteRef.current.set(k, note);
        press(note);
      }
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const note = keyNoteRef.current.get(k);
      if (note !== undefined) {
        keyNoteRef.current.delete(k);
        release(note);
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);

    window.__miditutorDev = {
      play: (notes, holdMs = 80) => {
        const list = Array.isArray(notes) ? notes : [notes];
        list.forEach(press);
        setTimeout(() => list.forEach(release), holdMs);
      },
    };

    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      delete window.__miditutorDev;
    };
  }, []);

  const base = baseNote(octave);

  return (
    <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs text-amber-400/80">
        <span className="rounded bg-amber-800/40 px-1.5 py-0.5 font-mono uppercase tracking-wider">
          dev
        </span>
        <span>
          Virtual keyboard — Z…M = lower octave, Q…P = upper. <kbd>-</kbd>/<kbd>=</kbd> shift octave
          (now C{octave}–E{octave + 2}). Routes through the real MIDI path.
        </span>
      </div>
      <div className="flex gap-0.5">
        {KEY_OFFSETS.map((k) => {
          const note = base + k.offset;
          const black = BLACK.has(k.offset % 12);
          return (
            <button
              key={k.key}
              onMouseDown={() => press(note)}
              onMouseUp={() => release(note)}
              onMouseLeave={() => release(note)}
              className={`flex h-16 min-w-0 flex-1 select-none flex-col items-center justify-end rounded-b pb-1 text-[9px] font-medium transition-colors ${
                held.has(note)
                  ? 'bg-indigo-500 text-white'
                  : black
                    ? 'bg-gray-900 text-gray-400 hover:bg-gray-800'
                    : 'bg-gray-200 text-gray-700 hover:bg-white'
              }`}
            >
              <span className="opacity-60">{k.key.toUpperCase()}</span>
              <span>{pitchToDisplayName(midiNumberToPitch(note))}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
