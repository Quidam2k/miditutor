import { useEffect, useRef, useCallback } from 'react';
// vexflow@5 ships a types entry that re-exports its classes via `export *`.
// Under moduleResolution:"bundler" — once OSMD (with its own nested vexflow) is
// in the dependency tree — TypeScript stops surfacing those members, as named
// imports or as statics on the default export, even though both exist and work
// at runtime (vite/esbuild resolve them fine; the staff renders correctly).
// Isolate that tooling quirk here with a typed shim rather than leaking `any`
// or contorting the rest of the file. Revisit if vexflow/TS resolves it.
import Vex from 'vexflow';

// vexflow's `exports` map also blocks deep type subpaths, so we can't even pull
// the real class types by path. Type the statics loosely here; this file's own
// logic stays typed, only the vexflow class refs go untyped.
/* eslint-disable @typescript-eslint/no-explicit-any */
interface VexFlowStatics {
  Renderer: any;
  Stave: any;
  StaveNote: any;
  Voice: any;
  Formatter: any;
  Accidental: any;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
const { Renderer, Stave, StaveNote, Voice, Formatter, Accidental } =
  Vex as unknown as VexFlowStatics;
import { Pitch, Clef } from '../../types/music';
import { MajorKey, pitchToVexFlowKey, getVexFlowAccidental, printedAccidental } from '../../engine/MusicTheory';

interface UseVexFlowOptions {
  notes: Pitch[];
  clef: Clef;
  highlightColor?: string | null; // null = default, 'green', 'red'
  /** Keys he played that were not asked for, drawn red beside the target. */
  wrongNotes?: Pitch[];
  /** Draw this signature and print accidentals relative to it (#10262). */
  musicKey?: MajorKey | null;
}

const HIGHLIGHT: Record<string, string> = { green: '#22c55e', red: '#ef4444' };
const WRONG_RED = '#ef4444';

export function useVexFlow({ notes, clef, highlightColor, wrongNotes, musicKey }: UseVexFlowOptions) {
  const containerRef = useRef<HTMLDivElement>(null);

  const render = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    // Clear previous render
    container.innerHTML = '';

    const renderer = new Renderer(container, Renderer.Backends.SVG);
    const width = container.clientWidth;
    const height = 180;
    renderer.resize(width, height);

    const context = renderer.getContext();
    context.setFont('Arial', 10);

    // Create stave centered in container
    const staveWidth = Math.min(300, width - 40);
    const staveX = (width - staveWidth) / 2;
    const stave = new Stave(staveX, 20, staveWidth);
    stave.addClef(clef);
    if (musicKey) stave.addKeySignature(musicKey.name);
    stave.setContext(context).draw();

    if (notes.length === 0) return;

    // One whole note (or chord) per group: the target, then, after a wrong answer,
    // the key(s) he actually played in red beside it (#4045).
    const makeNote = (pitches: Pitch[], color: string | null, accidentalOf: (pitch: Pitch) => string | null) => {
      const sorted = [...pitches].sort((a, b) => a.midiNumber - b.midiNumber);
      const note = new StaveNote({ keys: sorted.map(pitchToVexFlowKey), duration: 'w', clef });
      sorted.forEach((pitch, i) => {
        const acc = accidentalOf(pitch);
        if (acc) note.addModifier(new Accidental(acc), i);
      });
      if (color) note.setStyle({ fillStyle: color, strokeStyle: color });
      return note;
    };
    const printed = (pitch: Pitch) => (musicKey ? printedAccidental(pitch, musicKey.fifths) : getVexFlowAccidental(pitch));
    // On the target's own line, a bare red note would read as the target's accidental carrying on: spell it out.
    const printedWrong = (pitch: Pitch) => {
      const acc = printed(pitch);
      const sameLine = notes.some((t) => t.note === pitch.note && t.octave === pitch.octave && printed(t));
      return acc ?? (musicKey && sameLine ? getVexFlowAccidental(pitch) ?? 'n' : null);
    };

    const tickables = [makeNote(notes, highlightColor ? HIGHLIGHT[highlightColor] ?? null : null, printed)];
    if (wrongNotes && wrongNotes.length > 0) tickables.push(makeNote(wrongNotes, WRONG_RED, printedWrong));

    const voice = new Voice({ numBeats: 4 * tickables.length, beatValue: 4 });
    voice.addTickables(tickables);
    // A signature can eat a fifth of the stave: fit what's left of it.
    const noteWidth = musicKey ? stave.getNoteEndX() - stave.getNoteStartX() - 30 : staveWidth - 60;
    new Formatter().joinVoices([voice]).format([voice], noteWidth);
    voice.draw(context, stave);
  }, [notes, clef, highlightColor, wrongNotes, musicKey]);

  useEffect(() => {
    render();

    // Re-render on resize
    const observer = new ResizeObserver(() => render());
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    return () => observer.disconnect();
  }, [render]);

  return containerRef;
}
