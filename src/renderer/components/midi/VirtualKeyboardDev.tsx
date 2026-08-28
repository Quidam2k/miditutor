import { useEffect, useRef, useState } from 'react';
import { useMidiStore } from '../../store/useMidiStore';

// DEV-ONLY input source. Lets you exercise the MIDI monitor and the exercise
// engine from the computer keyboard (or mouse) when no hardware / loopMIDI is
// attached. Routes through the store's ingestNote — the exact same path the
// real keyboard uses. Gate its render behind import.meta.env.DEV.

// One octave starting at C4 (MIDI 60), Ableton-style home-row layout, + high C.
const KEY_MAP: { key: string; note: number; label: string; black: boolean }[] = [
  { key: 'a', note: 60, label: 'C4', black: false },
  { key: 'w', note: 61, label: 'C#4', black: true },
  { key: 's', note: 62, label: 'D4', black: false },
  { key: 'e', note: 63, label: 'D#4', black: true },
  { key: 'd', note: 64, label: 'E4', black: false },
  { key: 'f', note: 65, label: 'F4', black: false },
  { key: 't', note: 66, label: 'F#4', black: true },
  { key: 'g', note: 67, label: 'G4', black: false },
  { key: 'y', note: 68, label: 'G#4', black: true },
  { key: 'h', note: 69, label: 'A4', black: false },
  { key: 'u', note: 70, label: 'A#4', black: true },
  { key: 'j', note: 71, label: 'B4', black: false },
  { key: 'k', note: 72, label: 'C5', black: false },
];

const VELOCITY = 100;

export function VirtualKeyboardDev() {
  const ingestNote = useMidiStore((s) => s.ingestNote);
  const [held, setHeld] = useState<Set<number>>(new Set());
  const heldRef = useRef<Set<number>>(new Set());

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
      const entry = KEY_MAP.find((k) => k.key === e.key.toLowerCase());
      if (entry) {
        e.preventDefault();
        press(entry.note);
      }
    };
    const up = (e: KeyboardEvent) => {
      const entry = KEY_MAP.find((k) => k.key === e.key.toLowerCase());
      if (entry) release(entry.note);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  return (
    <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs text-amber-400/80">
        <span className="rounded bg-amber-800/40 px-1.5 py-0.5 font-mono uppercase tracking-wider">
          dev
        </span>
        <span>Virtual keyboard — type the labeled keys or click. Routes through the real MIDI path.</span>
      </div>
      <div className="flex gap-1">
        {KEY_MAP.map((k) => (
          <button
            key={k.note}
            onMouseDown={() => press(k.note)}
            onMouseUp={() => release(k.note)}
            onMouseLeave={() => release(k.note)}
            className={`flex h-16 w-10 select-none flex-col items-center justify-end rounded-b pb-1 text-[10px] font-medium transition-colors ${
              held.has(k.note)
                ? 'bg-indigo-500 text-white'
                : k.black
                  ? 'bg-gray-900 text-gray-400 hover:bg-gray-800'
                  : 'bg-gray-200 text-gray-700 hover:bg-white'
            }`}
          >
            <span className="opacity-60">{k.key.toUpperCase()}</span>
            <span>{k.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
