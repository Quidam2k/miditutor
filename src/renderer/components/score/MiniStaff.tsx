import { useEffect, useRef } from 'react';
import type { Pitch, Clef } from '../../types/music';
import { pitchToVexFlowKey, printedAccidental } from '../../engine/MusicTheory';
import Vex from 'vexflow';

/* eslint-disable @typescript-eslint/no-explicit-any */
interface VexFlowStatics { Renderer: any; Stave: any; StaveNote: any; Voice: any; Formatter: any; Accidental: any; StaveConnector: any; }
/* eslint-enable @typescript-eslint/no-explicit-any */
const { Renderer, Stave, StaveNote, Voice, Formatter, Accidental, StaveConnector } = Vex as unknown as VexFlowStatics;

export interface MiniStaffPart {
  clef: Clef;
  notes: Pitch[];
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const keyNames = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];

export function keyNameOfFifths(fifths: number): string {
  return keyNames[Math.trunc(clamp(fifths, -7, 7)) + 7]!;
}

export function miniStaffParts(upper: MiniStaffPart, lower: MiniStaffPart): MiniStaffPart[] {
  return [upper, lower].filter(part => part.notes.length > 0);
}

export function MiniStaff({ parts, fifths, centerPct }: {
  parts: MiniStaffPart[];
  fifths: number;
  centerPct: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const drawing = {
    fifths: Math.trunc(clamp(fifths, -7, 7)),
    parts: parts.map(part => ({
      clef: part.clef,
      notes: [...new Map(part.notes.map(pitch => [pitch.midiNumber, pitch])).values()]
        .sort((a, b) => a.midiNumber - b.midiNumber)
        .map(pitch => ({
          key: pitchToVexFlowKey(pitch),
          accidental: printedAccidental(pitch, Math.trunc(clamp(fifths, -7, 7))),
        })),
    })),
  };
  const signature = JSON.stringify(drawing);
  const allKeys = drawing.parts.flatMap(part => part.notes.map(note => note.key));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    try {
      container.innerHTML = '';
      const data = JSON.parse(signature) as typeof drawing;
      if (data.parts.length === 0) return;
      const scale = 0.7;
      const staveWidth = 100 + 10 * Math.abs(data.fifths);
      // Draw on a roomy page, then crop to what was drawn, so ledger notes never clip.
      const renderer = new Renderer(container, Renderer.Backends.SVG);
      renderer.resize(staveWidth + 24, 400);
      const context = renderer.getContext();

      const staves = data.parts.map((part, index) => {
        const stave = new Stave(16, 120 + index * 75, staveWidth);
        stave.addClef(part.clef).addKeySignature(keyNameOfFifths(data.fifths));
        stave.setContext(context).draw();
        if (part.notes.length > 0) {
          const note = new StaveNote({
            clef: part.clef,
            keys: part.notes.map(pitch => pitch.key),
            duration: 'w',
          });
          part.notes.forEach((pitch, noteIndex) => {
            if (pitch.accidental !== null) {
              note.addModifier(new Accidental(pitch.accidental), noteIndex);
            }
          });
          const voice = new Voice({ num_beats: 4, beat_value: 4 });
          voice.setStrict(false).addTickables([note]);
          new Formatter().joinVoices([voice]).formatToStave([voice], stave);
          voice.draw(context, stave);
        }
        return stave;
      });

      if (staves.length === 2) {
        for (const type of [StaveConnector.type.BRACE, StaveConnector.type.SINGLE_LEFT]) {
          new StaveConnector(staves[0], staves[1]).setType(type).setContext(context).draw();
        }
      }
      const svg = container.querySelector('svg');
      const box = svg?.getBBox();
      if (svg && box && box.width > 0) {
        const pad = 4;
        svg.setAttribute('viewBox', `${box.x - pad} ${box.y - pad} ${box.width + 2 * pad} ${box.height + 2 * pad}`);
        const w = `${Math.ceil((box.width + 2 * pad) * scale)}px`;
        const h = `${Math.ceil((box.height + 2 * pad) * scale)}px`;
        svg.setAttribute('width', w);
        svg.setAttribute('height', h);
        svg.style.width = w;
        svg.style.height = h;
      }
    } catch (err) {
      console.warn('[mini-staff] could not draw', err);
    }

    return () => { container.innerHTML = ''; };
  }, [signature]);

  if (parts.length === 0) return null;

  return (
    <div
      data-testid="mini-staff"
      data-clefs={parts.map(p => p.clef).join('+')}
      data-keys={allKeys.join(' ')}
      className="pointer-events-none absolute bottom-full z-30 mb-1 rounded-md bg-white px-1 shadow-lg"
      style={{ left: `${clamp(centerPct, 6, 94)}%`, transform: 'translateX(-50%)' }}
    >
      <div ref={containerRef} />
    </div>
  );
}
