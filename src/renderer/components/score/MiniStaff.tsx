import { useEffect, useRef } from 'react';
import type { Pitch, Clef } from '../../types/music';
import { pitchToVexFlowKey, printedAccidental } from '../../engine/MusicTheory';
import Vex from 'vexflow';

/* eslint-disable @typescript-eslint/no-explicit-any */
interface VexFlowStatics {
  Renderer: any; Stave: any; StaveNote: any; Voice: any; Formatter: any; Accidental: any;
  Dot: any; StaveTie: any;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
const { Renderer, Stave, StaveNote, Voice, Formatter, Accidental, Dot, StaveTie } =
  Vex as unknown as VexFlowStatics;

/** A written duration: VexFlow's code ('q', '8', ...) and its dots. */
export interface MiniDuration {
  duration: string;
  dots: number;
}

/** One written note on this beat, as the score has it (#11092). */
export interface MiniStaffNote extends Pitch, MiniDuration {
  /** Tied on into the next note. */
  tie?: boolean;
}

export interface MiniStaffPart {
  clef: Clef;
  notes: MiniStaffNote[];
  /** The hand rests on this beat (only drawn when it has no notes). */
  rest?: MiniDuration;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const keyNames = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];

export function keyNameOfFifths(fifths: number): string {
  return keyNames[Math.trunc(clamp(fifths, -7, 7)) + 7]!;
}

const CODES: [number, string][] = [[1, 'w'], [1 / 2, 'h'], [1 / 4, 'q'], [1 / 8, '8'], [1 / 16, '16'], [1 / 32, '32'], [1 / 64, '64']];
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/**
 * The written duration of a note, in whole notes. `type` is the length of its <type>
 * (OSMD's TypeLength) and `dots` its <dot>s; `length` (what it sounds for) is the
 * fallback when the type is missing. Anything unrecognised is drawn as a quarter.
 */
export function miniDuration(type: number | undefined, dots: number | undefined, length?: number): MiniDuration {
  const plain = type !== undefined && CODES.find(([v]) => near(v, type));
  if (plain) return { duration: plain[1], dots: Math.max(0, Math.min(2, dots ?? 0)) };
  const value = type ?? length;
  if (value !== undefined) {
    for (const [v, code] of CODES) {
      for (let d = 0; d <= 2; d++) {
        if (near(v * (2 - 1 / 2 ** d), value)) return { duration: code, dots: d };
      }
    }
  }
  return { duration: 'q', dots: 0 };
}

/** Height of the band the staves live in, above the keyboard (#11089). */
export const MINI_STAFF_BAND_PX = 72;

/** A hand's scrap of staff, centred over that hand's keys. */
export interface MiniStaffPlaced extends MiniStaffPart {
  hand: 'right' | 'left';
  pct: number;
  align: 'center' | 'left' | 'right';
}

/**
 * #11091: one staff per hand, each over its own keys. When the hands are too close for two
 * staves side by side, they part at the midpoint: left hand to the left, right hand to the right.
 * A hand with neither notes nor a rest on this beat gets no staff.
 */
export function miniStaffPlacements(
  right: MiniStaffPart & { pct: number },
  left: MiniStaffPart & { pct: number },
  minGapPct = 14,
): MiniStaffPlaced[] {
  const hands = [
    { ...right, hand: 'right' as const },
    { ...left, hand: 'left' as const },
  ].filter(h => h.notes.length > 0 || h.rest);
  if (hands.length === 2 && Math.abs(right.pct - left.pct) < minGapPct) {
    const mid = clamp((right.pct + left.pct) / 2, minGapPct, 100 - minGapPct);
    return hands.map(h => ({ ...h, pct: mid, align: h.hand === 'right' ? 'left' : 'right' }));
  }
  return hands.map(h => ({ ...h, pct: clamp(h.pct, 7, 93), align: 'center' }));
}

export function MiniStaff({ part, fifths, pct, align }: {
  part: MiniStaffPart;
  fifths: number;
  pct: number;
  align: MiniStaffPlaced['align'];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const keySig = Math.trunc(clamp(fifths, -7, 7));
  const notes = [...new Map(part.notes.map(n => [n.midiNumber, n])).values()]
    .sort((a, b) => a.midiNumber - b.midiNumber)
    .map(n => ({
      key: pitchToVexFlowKey(n),
      accidental: printedAccidental(n, keySig),
      duration: n.duration,
      dots: n.dots,
      tie: !!n.tie,
    }));
  const rest = notes.length === 0 ? part.rest ?? null : null;
  const drawing = { fifths: keySig, clef: part.clef, notes, rest };
  const signature = JSON.stringify(drawing);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    try {
      container.innerHTML = '';
      const data = JSON.parse(signature) as typeof drawing;
      if (data.notes.length === 0 && !data.rest) return;
      const staveWidth = 100 + 10 * Math.abs(data.fifths);
      // Draw on a roomy page, then crop to what was drawn, so ledger notes never clip.
      const renderer = new Renderer(container, Renderer.Backends.SVG);
      renderer.resize(staveWidth + 24, 400);
      const context = renderer.getContext();

      const stave = new Stave(16, 120, staveWidth);
      stave.addClef(data.clef).addKeySignature(keyNameOfFifths(data.fifths));
      stave.setContext(context).draw();
      // Crop to the staff lines (plus clef overhang) and the notes. The SVG's own
      // bounding box is useless vertically: the font glyphs report huge ascent/descent.
      let top = stave.getYForLine(0) - 14;
      let bottom = stave.getYForLine(4) + 14;

      // One chord per written duration (two voices in one hand, e.g. a held half under
      // a quarter), stems apart when there are two or more.
      const groups = new Map<string, typeof data.notes>();
      for (const n of data.notes) {
        const id = `${n.duration}.${n.dots}`;
        groups.set(id, [...(groups.get(id) ?? []), n]);
      }
      const chords = [...groups.values()].map((group, gi) => {
        const first = group[0]!;
        const note = new StaveNote({
          clef: data.clef,
          keys: group.map(n => n.key),
          duration: first.duration,
          dots: first.dots,
          ...(groups.size > 1 ? { stemDirection: gi === 0 ? 1 : -1 } : { autoStem: true }),
        });
        for (let d = 0; d < first.dots; d++) Dot.buildAndAttach([note], { all: true });
        group.forEach((n, i) => {
          if (n.accidental !== null) note.addModifier(new Accidental(n.accidental), i);
        });
        return { note, ties: group.flatMap((n, i) => (n.tie ? [i] : [])) };
      });
      if (data.rest) {
        const note = new StaveNote({
          clef: data.clef,
          keys: [data.clef === 'bass' ? 'd/3' : 'b/4'],
          duration: `${data.rest.duration}r`,
          dots: data.rest.dots,
        });
        for (let d = 0; d < data.rest.dots; d++) Dot.buildAndAttach([note], { all: true });
        chords.push({ note, ties: [] });
      }

      const voices = chords.map(c => new Voice({ numBeats: 4, beatValue: 4 }).setStrict(false).addTickables([c.note]));
      new Formatter().joinVoices(voices).format(voices, staveWidth - (stave.getNoteStartX() - stave.getX()) - 20);
      voices.forEach(v => v.draw(context, stave));
      for (const c of chords) {
        if (c.ties.length > 0) {
          // A tie going on into the next beat: drawn from this note to the staff's end.
          new StaveTie({ firstNote: c.note, lastNote: null, firstIndexes: c.ties, lastIndexes: c.ties })
            .setContext(context).draw();
        }
        // Heads and stem only: the note's bounding box is not trustworthy for the crop.
        const ys: number[] = [...(c.note.getYs() as number[])];
        if (c.note.hasStem?.()) {
          const stem = c.note.getStemExtents() as { topY: number; baseY: number };
          ys.push(stem.topY, stem.baseY);
        }
        top = Math.min(top, Math.min(...ys) - 8);
        bottom = Math.max(bottom, Math.max(...ys) + 8);
      }

      const svg = container.querySelector('svg');
      const box = svg?.getBBox();
      if (svg && box && box.width > 0 && bottom > top) {
        const pad = 4;
        const vw = box.width + 2 * pad;
        const vh = bottom - top;
        const scale = Math.min(0.7, (MINI_STAFF_BAND_PX - 6) / vh);
        svg.setAttribute('viewBox', `${box.x - pad} ${top} ${vw} ${vh}`);
        const w = `${Math.ceil(vw * scale)}px`;
        const h = `${Math.ceil(vh * scale)}px`;
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

  if (notes.length === 0 && !rest) return null;
  const shift = align === 'center' ? '-50%' : align === 'right' ? 'calc(-100% - 4px)' : '4px';

  return (
    <div
      data-testid="mini-staff"
      data-clefs={part.clef}
      data-keys={notes.map(n => n.key).join(' ')}
      data-durations={notes.map(n => n.duration + '.'.repeat(n.dots)).join(' ') || (rest ? `${rest.duration}r` : '')}
      className="pointer-events-none absolute bottom-0.5 z-30"
      style={{ left: `${pct}%`, transform: `translateX(${shift})` }}
    >
      <div ref={containerRef} />
    </div>
  );
}
