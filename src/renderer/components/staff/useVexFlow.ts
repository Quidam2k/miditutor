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
import { pitchToVexFlowKey, getVexFlowAccidental } from '../../engine/MusicTheory';

interface UseVexFlowOptions {
  notes: Pitch[];
  clef: Clef;
  highlightColor?: string | null; // null = default, 'green', 'red'
}

export function useVexFlow({ notes, clef, highlightColor }: UseVexFlowOptions) {
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
    stave.setContext(context).draw();

    if (notes.length === 0) return;

    // Create VexFlow notes
    const staveNotes = notes.map((pitch) => {
      const key = pitchToVexFlowKey(pitch);
      const staveNote = new StaveNote({
        keys: [key],
        duration: 'w', // whole note
        clef,
      });

      // Add accidental if needed
      const acc = getVexFlowAccidental(pitch);
      if (acc) {
        staveNote.addModifier(new Accidental(acc));
      }

      // Color the note
      if (highlightColor) {
        const color = highlightColor === 'green' ? '#22c55e' : '#ef4444';
        staveNote.setStyle({ fillStyle: color, strokeStyle: color });
      }

      return staveNote;
    });

    // If multiple notes, show them as a chord (single StaveNote with multiple keys)
    // But our current approach creates separate StaveNotes, which is fine for intervals
    // displayed sequentially. For the MVP, let's show them as separate whole notes.

    // Actually, for intervals we want both notes visible. Let's create one StaveNote
    // with multiple keys if there are multiple pitches.
    if (notes.length > 1) {
      const keys = notes.map(pitchToVexFlowKey);
      const chordNote = new StaveNote({
        keys: keys.sort(), // VexFlow expects keys sorted low to high
        duration: 'w',
        clef,
      });

      // Add accidentals
      notes.forEach((pitch, i) => {
        const acc = getVexFlowAccidental(pitch);
        if (acc) {
          chordNote.addModifier(new Accidental(acc), i);
        }
      });

      if (highlightColor) {
        const color = highlightColor === 'green' ? '#22c55e' : '#ef4444';
        chordNote.setStyle({ fillStyle: color, strokeStyle: color });
      }

      const voice = new Voice({ numBeats: 4, beatValue: 4 });
      voice.addTickables([chordNote]);
      new Formatter().joinVoices([voice]).format([voice], staveWidth - 60);
      voice.draw(context, stave);
    } else {
      const voice = new Voice({ numBeats: 4, beatValue: 4 });
      voice.addTickables(staveNotes);
      new Formatter().joinVoices([voice]).format([voice], staveWidth - 60);
      voice.draw(context, stave);
    }
  }, [notes, clef, highlightColor]);

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
