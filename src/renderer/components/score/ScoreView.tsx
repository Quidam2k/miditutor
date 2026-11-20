import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { OpenSheetMusicDisplay, TechnicalInstruction, TechnicalInstructionType } from 'opensheetmusicdisplay';
// eslint-disable-next-line import/no-unresolved -- Vite ?raw import, not resolvable by eslint-plugin-import
import sampleXml from '../../assets/sample-score.musicxml?raw';
// eslint-disable-next-line import/no-unresolved -- Vite ?raw import, not resolvable by eslint-plugin-import
import minuetXml from '../../assets/minuet-in-g.musicxml?raw';
// eslint-disable-next-line import/no-unresolved -- Vite ?raw import, not resolvable by eslint-plugin-import
import aMinorXml from '../../assets/a-minor-scale.musicxml?raw';
// eslint-disable-next-line import/no-unresolved -- Vite ?raw import, not resolvable by eslint-plugin-import
import expressionXml from '../../assets/expression-test.musicxml?raw';
import { MISS_KINDS, MISS_KIND_LABEL, MISS_VOLUME_MAX, initAudio, playChime, playChord, playFanfare, playLapChime, playMissSound, playNote, missGateOpen, releaseChords } from '../../audio/AudioEngine';
import { emitRep } from '../../store/useRepStore';
import { overrunNote, startOverrun, type Overrun } from '../../engine/Overrun';
import { beatMs, clampBpm, closeLap, countInBeats, keepNote, lapBeats, lapEndMs, lapLabel, startKeep, stepAt, type KeepRun } from '../../engine/KeepGoing';
import { climbLabel, climbLap, climbPercent, parseTempo, startClimb, type Climb } from '../../engine/TempoClimb';
import { rolandOffNow, rolandSend } from '../../engine/RolandMetronome';
import { markedTempo, playedTempo } from '../../engine/Tempo';
import { slowBars, speedVsMisses } from '../../engine/SpeedMisses';
import {
  ADVICE_PAUSE_MS, ADVICE_STALE_MS, actionLabel, gapOpen, mayOffer, pauseCard, reshapeCard, speedCard, spotBackCard,
  velocityCard, worseCard, type AdviceCard, type AdviceRule,
} from '../../engine/Advice';
import { buildPlan, LESSON_MIN_LAPS, lessonLabel, lessonLapDone, nextLabel, skipStep, type LessonState } from '../../engine/LessonPlan';
import { loopReshape, pauseBefore, spotBack, velocityOutlier, worseThanBest, type Run, type VelSample } from '../../engine/AdviceRules';
import { PianoKeyboard88, keyCenterPct } from '../homework/PianoKeyboard88';
import { MiniStaff, MiniStaffPart, miniStaffPlacements, miniDuration, MINI_STAFF_BAND_PX } from './MiniStaff';
import { PracticeReport } from './PracticeReport';
import { PracticeSettings } from './PracticeSettings';
import { WaveOverlay, WAVE_FLARE_MS, waveDelays, type WaveDot } from './WaveOverlay';
import { hesitationMs, PACE_SAMPLES } from '../../engine/TrainingWheels';
import { useMidiStore } from '../../store/useMidiStore';
import { ScoreFollower, ScoreStep, heldTies, soundUntil } from '../../engine/ScoreFollower';
import { ExpressionTracker, describeMark, parseExpression, type ExpressionFinding } from '../../engine/Expression';
import { PedalCoach } from '../../engine/PedalCoach';
import { rememberRef, resolvePieceId } from './lastPiece';
import { orderChordFingers } from './chordFingers';
import { renderBinderHtml } from './binderRender';
import { BinderPreview, type BinderPreviewData } from './BinderPreview';
import { fingersLowToHigh, nextFinger, passLoopEdge, prevPlayable, stepForWheel, stepOfBar, wheelNotch } from './noteEdit';
import { chunkLabel, grewLabel, lapDone, loopEnd, parseTargets, rangeEdited, reachedLabel, startChunk, type ChunkState } from '../../engine/BackwardChunk';
import { outerFor, outwardGrewLabel, outwardLabel, outwardLapDone, outwardRangeEdited, starsInOrder, starsOf, startOutward } from '../../engine/OutwardChunk';
import { addSpot, AUTO_MAX_PER_CHECK, AUTO_OPEN_CAP, autoSpots, countPass, MAX_SPOT_BARS, prune, spotAround, spotLabel, type Spot } from '../../engine/TroubleSpots';
import { localDay, own } from '../../store/useSettingsStore';
import type { Rollup } from '../../../shared/practiceRollup';
import { KeyGate, gateAsk, gateShown, keyGate, keyGateInput } from '../../engine/KeyFirst';
import { BLOCK_WRONG_NOTE, blockHowTo, blockInput, blockLabel, current as blockPosition, pressTogether, groupPositions, showKeys, startBlocking, type BlockState, type BlockStep } from '../../engine/Blocking';
import { BarInput } from './BarInput';
import { centreShift, fitZoom } from '../../engine/stripFit';
import { Popover } from './Popover';
import { ORDER, PLACEMENT, staticFront, type ControlId } from './toolbarPlacement';
import { useCorral } from './useCorral';
import { hiddenOnCount } from '../../engine/Corral';
import { loadStartupSnapshot, restorable, type SessionSnapshot } from './sessionSnapshot';
import { pickBars, pickHand, pickSightPiece } from '../../engine/SightRead';
import { FRESH_KEYS, freshTuneXml, pickFreshTune, type FreshTune } from '../../engine/FreshTune';
import freshTunesJson from '../../assets/fresh-tunes.json';
import { useTutorStore } from '../../store/useTutorStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { PieceTrust, trustBadge, trustMark, trustTitle } from '../../../shared/trust';
import type { MixChoice } from '../../../shared/mix';
import type { PieceGroupRef } from '../../../shared/versions';
import { reportEvent, reportScreen } from '../tutor/useTutorBridge';
import { startBare, bareNote, bareMiss, closeBar, BARE_MS, type BareRun } from '../../engine/TrainingWheels';
import { hintsSnapshot, sameHints, type HintsSnapshot } from '../../engine/HintsState';
import { TaskPanel } from '../tutor/TaskPanel';
import { Band, PlayedOverlay, PlayedMark } from './PlayedOverlay';
import { ZoneOverlay, type ZoneBand, type ZoneMark } from './ZoneOverlay';
import { fishingShifts, handZones, type Shift } from '../../engine/HandZones';
import { ChordOverlay, type ChordRing, type ChordTag } from './ChordOverlay';
import { chordChanges, movedBy } from '../../engine/ChordMoves';
import { MixBuilder } from './MixBuilder';
import { OriginalScan, useScanLayout } from './OriginalScan';
import { holdsOf, planSpread, setFingering, setHold, spreadFingering, type Digit, type FingerTarget } from '../../../shared/fingering';
import { ChordSymbol, chordSymbol, playsChord } from './chordSymbols';
import {
  WrittenNote,
  accidentalMark,
  clefForMidi,
  drawnNote,
  ottavaHint,
  ottavaShift,
  spellPlayed,
  staffOffsetSteps,
  writtenName,
} from '../../../shared/notation';
import { dropChordRests } from '../../engine/chordRests';

// Milestone 2: the score follows live MIDI. Each OSMD cursor position becomes a
// ScoreStep (the notes that must be newly struck there); ScoreFollower decides
// when to advance. Correct notes turn green, a wrong note flashes the expected
// notes red and does not advance. Manual prev/next/reset still work and re-sync
// the follower. OSMD handles real scores; VexFlow stays for generated drills.

interface Piece {
  id: string;
  label: string;
  /** MusicXML text; empty for a photo-only piece. */
  xml: string;
  /** Data URL of the original photo, when the piece came from one. */
  photo?: string;
  targetBpm?: number;
  /** What trust.json says about this score (OMR audit); absent for built-in and pushed pieces. */
  trust?: PieceTrust;
  /** Its place among the song's versions (versions.json); label is then the song's title. */
  group?: PieceGroupRef;
}

// One order for the piece list (#9611): alphabetical by the shown title, ignoring
// case and leading punctuation ('O Sole Mio files under O); "The" is not stripped.
const sortKey = (label: string) => label.replace(/^[^\p{L}\p{N}]+/u, '');
const byTitle = (a: Piece, b: Piece) =>
  sortKey(a.label).localeCompare(sortKey(b.label), undefined, { sensitivity: 'base', numeric: true });

const PIECES: Piece[] = [
  { id: 'minuet', label: 'Minuet in G (simplified) — Petzold', xml: minuetXml, targetBpm: 100 },
  { id: 'a-minor', label: 'A minor scale (natural, hands together)', xml: aMinorXml },
  { id: 'sample', label: 'Sample: C scale + Ode to Joy', xml: sampleXml },
  { id: 'expression', label: 'Expression test (p, f, cresc., rit.)', xml: expressionXml },
];

// Minimal structural view of the OSMD internals we touch; OSMD's own types are
// deep and partly internal, so we narrow to what we use and guard at runtime.
interface OsmdNote {
  halfTone: number;
  isRest(): boolean;
  IsGraceNote?: boolean;
  NoteTie?: { StartNote?: unknown } | null;
  Pitch?: { FundamentalNote: number; Octave: number; AccidentalHalfTones: number };
  ParentStaff?: { idInMusicSheet: number };
  /** Its voice entry; Timestamp is from the start of its measure (whole notes). */
  ParentVoiceEntry?: { Timestamp?: { RealValue: number }; TechnicalInstructions?: unknown[] };
  Length?: { RealValue: number };
  /** The length its <type> names, and its <dot>s (#11092). */
  TypeLength?: { RealValue: number };
  DotsXml?: number;
  /** Its own <fingering>, when the score gives one. */
  Fingering?: { value?: string } | null;
}
interface OsmdBox {
  AbsolutePosition: { x: number; y: number };
  BorderLeft: number;
  BorderRight: number;
  BorderTop: number;
  BorderBottom: number;
}
interface OsmdMeasure {
  InitiallyActiveClef?: { ClefType: number };
  ParentMusicSystem?: { Parent?: { PageNumber: number } };
  ParentStaffLine?: { PositionAndShape: { AbsolutePosition: { y: number } } };
  PositionAndShape?: OsmdBox;
}
interface OsmdGraphicalNote {
  /** The group of the whole chord, not this note: VexFlow draws a chord as one note. */
  getSVGGElement?: () => SVGGElement | undefined;
  /** Every head of that chord, lowest first. */
  getNoteheadSVGs?: () => Element[];
  /** [the VexFlow note, this note's place in its chord]. */
  vfnote?: [unknown, number];
  parentVoiceEntry?: { parentStaffEntry?: OsmdStaffEntry };
}
type OsmdPitch = { FundamentalNote: number; AccidentalHalfTones: number };
interface OsmdChordContainer {
  RootPitch?: OsmdPitch;
  BassPitch?: OsmdPitch;
  ChordKind: number;
}
interface OsmdVoiceEntry {
  ParentSourceStaffEntry?: { ChordContainers?: OsmdChordContainer[] };
}
interface OsmdStaffEntry {
  FingeringEntries?: { SVGNode?: Node; Label?: { text: string } }[];
  graphicalChordContainers?: { GetChordSymbolContainer: unknown; GraphicalLabel?: { SVGNode?: Node } }[];
}

/** The note whose finger / hold picker is open; alts = the same key in the other hand. */
interface FingerPick {
  x: number;
  y: number;
  target: FingerTarget;
  name: string;
  held: boolean;
  alts?: FingerTarget[];
}

/** A printed chord symbol (<harmony>) and the OSMD object it came from. */
type StepChord = ChordSymbol & { container: OsmdChordContainer };

const pcOf = (p: OsmdPitch) => p.FundamentalNote + p.AccidentalHalfTones;
const noChord = (): { chord: StepChord | null; played: Set<number>; lit: boolean } => ({
  chord: null,
  played: new Set(),
  lit: false,
});

const LETTER_OF: Record<number, WrittenNote['letter']> = { 0: 'C', 2: 'D', 4: 'E', 5: 'F', 7: 'G', 9: 'A', 11: 'B' };

// OSMD pitch -> MusicXML-style spelling (OSMD octave 1 = MusicXML octave 4).
function writtenOf(n: OsmdNote): WrittenNote | null {
  const p = n.Pitch;
  const letter = p && LETTER_OF[p.FundamentalNote];
  return letter ? { letter, alter: p.AccidentalHalfTones, octave: p.Octave + 3 } : null;
}

const staffOf = (n: OsmdNote) => n.ParentStaff?.idInMusicSheet ?? 0;

// Under an 8va line the notehead is drawn an octave below the pitch (#9986).
const shiftOf = (osmd: OpenSheetMusicDisplay, n: OsmdNote) =>
  ottavaShift((osmd.EngravingRules.GNote(n as never) as unknown as { octaveShift?: number } | undefined)?.octaveShift);

// The ottava hint for the first of `midis` written under an ottava line at this step.
function hintFor(osmd: OpenSheetMusicDisplay | null, stepNotes: OsmdNote[], midis: number[]): string {
  if (!osmd) return '';
  for (const n of stepNotes) {
    if (!midis.includes(toMidi(n))) continue;
    const hint = ottavaHint(shiftOf(osmd, n));
    if (hint) return hint;
  }
  return '';
}

// The steps covering bars first..last (a loop, #5004), or null if there are none.
function stepRangeOf(steps: ScoreStep[], first: number, last: number): { first: number; last: number } | null {
  const firstStep = steps.findIndex((st) => st.measure >= first);
  let lastStep = -1;
  steps.forEach((st, i) => {
    if (st.measure <= last) lastStep = i;
  });
  return firstStep < 0 || lastStep < firstStep ? null : { first: firstStep, last: lastStep };
}

// Keys down plus keys let go under the sustain pedal (#9480).
function soundingNow(): Set<number> {
  const { held, pedal, pedalRinging } = useMidiStore.getState();
  return new Set([...held, ...(pedal ? pedalRinging : [])]);
}

// First key signature in the file. Mid-piece key changes are not tracked (v1).
const fifthsOf = (xml: string) => Number(/<fifths>\s*(-?\d+)\s*<\/fifths>/.exec(xml)?.[1] ?? 0);

// OSMD's halfTone is 0 at C0 in its own octave scheme; MIDI = halfTone + 12 (C4 = 60).
const toMidi = (n: OsmdNote) => n.halfTone + 12;

// A note must be struck at this position unless it is a rest, a grace note, or the
// continuation of a tie (the key is already held down from an earlier position).
const isStruck = (n: OsmdNote) =>
  !n.isRest() && !n.IsGraceNote && !(n.NoteTie && n.NoteTie.StartNote !== n);

// Where a note sits, as the fingering / hold editors find it in the MusicXML.
const targetOf = (n: OsmdNote, measure: number): FingerTarget | null => {
  const onset = (n.ParentVoiceEntry?.Timestamp?.RealValue ?? NaN) * 4;
  return Number.isFinite(onset) ? { measure, staff: staffOf(n) + 1, onset, midi: toMidi(n) } : null;
};
const sameTarget = (a: FingerTarget, b: FingerTarget) =>
  a.measure === b.measure && a.staff === b.staff && Math.abs(a.onset - b.onset) < 1e-6 && a.midi === b.midi;
const gNoteOf = (osmd: OpenSheetMusicDisplay, n: OsmdNote) =>
  osmd.EngravingRules.GNote(n as never) as unknown as OsmdGraphicalNote | undefined;
/** #10258: a mark that only changes number stays where it is: swap the text, draw nothing. */
function swapFingerLabel(osmd: OpenSheetMusicDisplay, note: OsmdNote, was: string | undefined, digit: string): boolean {
  const labels = gNoteOf(osmd, note)?.parentVoiceEntry?.parentStaffEntry?.FingeringEntries ?? [];
  const same = labels.filter((l) => l.Label?.text === was);
  const node = same[0]?.SVGNode;
  if (same.length !== 1 || !same[0].Label || !(node instanceof SVGElement)) return false;
  const text = node.matches('text') ? node : node.querySelector('text');
  if (!text) return false;
  text.textContent = digit;
  same[0].Label.text = digit;
  return true;
}
const headOf = (g: OsmdGraphicalNote | undefined) => g?.getNoteheadSVGs?.()[g.vfnote?.[1] ?? 0];

// The note being edited, or the one the wheel would edit (#10236). No note drawn uses it.
const EDIT_YELLOW = '#ffe600';
const EDIT_OUTLINE = '#a16207';

// Tailwind's preflight sets `img { height: auto }`, which overrides the height
// attribute OSMD puts on its cursor <img> and collapses it to 1px. Mirror the
// attribute into an inline style whenever OSMD sets it (moves, re-renders).
function keepCursorHeight(container: HTMLElement): MutationObserver {
  const apply = (img: HTMLImageElement) => {
    const h = img.getAttribute('height');
    if (h) img.style.height = `${h}px`;
    img.style.maxWidth = 'none';
  };
  const obs = new MutationObserver((records) => {
    for (const r of records) {
      if (r.target instanceof HTMLImageElement) apply(r.target);
      r.addedNodes.forEach((n) => n instanceof HTMLImageElement && apply(n));
    }
  });
  obs.observe(container, { subtree: true, childList: true, attributes: true, attributeFilter: ['height'] });
  container.querySelectorAll('img').forEach(apply);
  return obs;
}

// Walk the cursor over the whole piece once to build the step list, then reset.
// Also records, per step, the written notes still sounding there (tie continuations
// and longer notes struck earlier), so a re-strike of one is not called wrong and a
// played note can be placed on the staff it is written on.
// Also the chord symbol in force at each step: one printed at a step lasts until
// the next one.
// #10146: notes he marked "hold" are not struck; like a tie, they ring on from before.
function extractSteps(osmd: OpenSheetMusicDisplay, hand: 'both' | 'right' | 'left', holds: FingerTarget[] = []): {
  steps: ScoreStep[];
  notes: OsmdNote[][];
  ringing: OsmdNote[][];
  ties: OsmdNote[][];
  chords: (StepChord | null)[];
  restBefore: boolean[];
  rests: OsmdNote[][];
} {
  const steps: ScoreStep[] = [];
  const notes: OsmdNote[][] = [];
  const rests: OsmdNote[][] = [];
  const ringing: OsmdNote[][] = [];
  // #10136: tie continuations of the selected hand, coloured blue while he holds them.
  const ties: OsmdNote[][] = [];
  const chords: (StepChord | null)[] = [];
  // #9976: the page is silent just before this step (a rest), so lifting the pedal is right.
  const restBefore: boolean[] = [];
  let soundEnd = 0; // where the last written sound so far ends, in beats
  let chord: StepChord | null = null;
  let active: { note: OsmdNote; end: number }[] = [];
  const selectedStaff = hand === 'both' || osmd.Sheet.Staves.length < 2 ? null : hand === 'right' ? 0 : 1;
  const cursor = osmd.cursor;
  cursor.reset();
  for (let guard = 0; guard < 20000 && !cursor.iterator.EndReached; guard++) {
    const all = cursor.NotesUnderCursor() as unknown as OsmdNote[];
    const measure = cursor.iterator.CurrentMeasureIndex + 1;
    const isHeld = (n: OsmdNote) => {
      const at = holds.length ? targetOf(n, measure) : null;
      return at !== null && holds.some((h) => sameTarget(h, at));
    };
    const struck = all.filter((n) => isStruck(n) && !isHeld(n));
    const under = struck.filter((n) => selectedStaff === null || staffOf(n) === selectedStaff);
    const other = struck.filter((n) => selectedStaff !== null && staffOf(n) !== selectedStaff);
    const beat = cursor.iterator.currentTimeStamp.RealValue * 4;
    active = active.filter((a) => a.end > beat + 1e-6);
    restBefore.push(steps.length > 0 && soundEnd < beat - 1e-6);
    // The other hand is optional, so playing its written notes is not wrong.
    const unstruck = all.filter((n) => !n.isRest() && (!isStruck(n) || isHeld(n)));
    const ring = [...active.map((a) => a.note), ...unstruck, ...other];
    steps.push({
      notes: under.map(toMidi),
      beat,
      measure,
      ringing: [...new Set(ring.map(toMidi))],
    });
    notes.push(under);
    rests.push(all.filter((n) => n.isRest() && (selectedStaff === null || staffOf(n) === selectedStaff)));
    ringing.push(ring);
    ties.push(unstruck.filter((n) => !n.IsGraceNote && (selectedStaff === null || staffOf(n) === selectedStaff)));
    const entries = cursor.iterator.CurrentVoiceEntries as unknown as OsmdVoiceEntry[];
    for (const c of entries.flatMap((ve) => ve.ParentSourceStaffEntry?.ChordContainers ?? [])) {
      const sym = c.RootPitch && chordSymbol(pcOf(c.RootPitch), c.ChordKind, c.BassPitch && pcOf(c.BassPitch));
      // A kind we can't spell (Neapolitan, 11ths) still ends the previous chord's span.
      chord = sym ? { ...sym, container: c } : null;
    }
    chords.push(chord);
    for (const n of all) {
      if (!n.isRest() && n.Length) {
        active.push({ note: n, end: beat + n.Length.RealValue * 4 });
        soundEnd = Math.max(soundEnd, beat + n.Length.RealValue * 4);
      }
    }
    cursor.next();
  }
  cursor.reset();
  return { steps, notes, ringing, ties, chords, restBefore, rests };
}

// Colour a chord symbol's text (green = he is playing that chord), or reset it.
function paintChord(osmd: OpenSheetMusicDisplay, container: OsmdChordContainer, on: boolean) {
  const list = osmd.GraphicSheet.MeasureList as unknown as ({ staffEntries?: OsmdStaffEntry[] } | undefined)[][];
  for (const staves of list) {
    for (const m of staves) {
      for (const se of m?.staffEntries ?? []) {
        for (const gc of se.graphicalChordContainers ?? []) {
          const node = gc.GetChordSymbolContainer === container ? gc.GraphicalLabel?.SVGNode : undefined;
          if (!(node instanceof SVGElement)) continue;
          for (const el of [node, ...node.querySelectorAll('*')] as SVGElement[]) {
            el.style.fill = on ? '#16a34a' : '';
            el.style.fontWeight = on ? 'bold' : '';
          }
        }
      }
    }
  }
}

// Keep fingerings distinct from measure numbers at a glance.
function paintFingerings(osmd: OpenSheetMusicDisplay, container: HTMLElement) {
  const list = osmd.GraphicSheet.MeasureList as unknown as ({ staffEntries?: OsmdStaffEntry[] } | undefined)[][];
  for (const staves of list) {
    for (const m of staves) {
      for (const se of m?.staffEntries ?? []) {
        for (const label of se.FingeringEntries ?? []) {
          const node = label.SVGNode;
          if (!(node instanceof SVGElement)) continue;
          for (const el of [node, ...node.querySelectorAll('*')] as SVGElement[]) {
            el.style.fill = '#7c3aed';
            el.style.fontWeight = 'bold';
          }
        }
      }
    }
  }
  for (const node of container.querySelectorAll<SVGElement>('.measure-number')) {
    for (const el of [node, ...node.querySelectorAll('*')] as SVGElement[]) {
      el.style.fill = '#9ca3af';
    }
  }
}

// Screen height left for a page under the header, sticky toolbar and keyboard strip.
const PAGE_RESERVE_PX = 320;
// #6373: the "Pages 3-4 of 7" bar sits in this much room above each spread.
const SPREAD_BAR_PX = 40;

// Pages side by side (#5137): each page is half the panel wide and as tall as the screen
// allows, not A4, so two pages fill a TV instead of two small portrait sheets.
// Zoom keeps about a printed page's worth of music on each.
function fitPages(osmd: OpenSheetMusicDisplay, container: HTMLElement) {
  const w = container.offsetWidth;
  if (!w) return; // hidden behind the photo view: keep the last page size
  osmd.setCustomPageFormat(w, Math.max(400, window.innerHeight - PAGE_RESERVE_PX - SPREAD_BAR_PX));
  osmd.Zoom = Math.max(0.5, Math.min(1, w / 1100));
}

// OSMD positions are relative to the bar's own page.
function pageSvgOf(osmd: OpenSheetMusicDisplay, container: HTMLElement, measureIdx0: number) {
  const staves = osmd.GraphicSheet.MeasureList[measureIdx0] as unknown as (OsmdMeasure | undefined)[] | undefined;
  const page = staves?.find((m) => m !== undefined)?.ParentMusicSystem?.Parent?.PageNumber;
  return (page ? container.querySelector<SVGSVGElement>('#osmdCanvasPage' + page + ' svg') : null)
    ?? container.querySelector('svg');
}

// Where the music's ink really is, in client px (#6055): OSMD's SVG box carries a wide blank margin,
// so measure what is drawn (staves, ledger lines, fingers, tempo mark, bar numbers), not the box.
function inkRect(svg: SVGSVGElement): { top: number; bottom: number } | null {
  const rect = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  const vbH = vb?.height || svg.height.baseVal.value || 0;
  const bb = svg.getBBox();
  if (!rect.height || !vbH || !bb.height) return null;
  const k = rect.height / vbH;
  const top = rect.top + (bb.y - (vb?.y ?? 0)) * k;
  return { top, bottom: top + bb.height * k };
}

/**
 * #6055: where the green cursor bar sits in the Strip panel, as a fraction of its width from the left.
 * Nothing left of it matters to him, so it sits at a quarter, not the middle, and more music shows ahead.
 */
const STRIP_ANCHOR = 0.25;

// Strip (#5153): zoom so the one long system fills the height between toolbar and keyboard.
// #6055: fit the music's ink, not the SVG box. With stripFitInk off, the old box fit (zoom 1..1.8).
// True when the zoom changed enough that the caller should render again.
function fitStrip(osmd: OpenSheetMusicDisplay, container: HTMLElement, panel: HTMLElement | null): boolean {
  const svg = container.querySelector('svg');
  const free = panel ? panel.clientHeight - 32 : 0; // minus the panel's p-4
  const drawn = svg?.getBoundingClientRect().height ?? 0;
  if (!svg || free <= 0 || drawn <= 0) return false; // hidden behind the photo view
  if (!useSettingsStore.getState().stripFitInk) {
    const zoom = Math.max(1, Math.min(1.8, (osmd.Zoom * free * 0.95) / drawn));
    if (Math.abs(zoom - osmd.Zoom) / osmd.Zoom < 0.05) return false;
    osmd.Zoom = zoom;
    return true;
  }
  const ink = inkRect(svg);
  if (!ink) return false;
  const zoom = fitZoom(ink.bottom - ink.top, free, osmd.Zoom);
  if (zoom === osmd.Zoom) return false;
  osmd.Zoom = zoom;
  return true;
}

/**
 * #6055: centre the music's ink in the panel (replaces #11094's 20% lift, which hid the symptom).
 * With stripFitInk off, the old lift of a fifth of the top gap.
 */
const STRIP_LIFT = 0.2;
function liftStrip(osmd: OpenSheetMusicDisplay, layer: HTMLElement | null, panel: HTMLElement | null): void {
  if (!layer) return;
  layer.style.transform = '';
  if (!panel) return;
  const svg = layer.querySelector('svg');
  if (!svg) return;
  if (useSettingsStore.getState().stripFitInk) {
    const ink = inkRect(svg);
    if (!ink) return;
    const pr = panel.getBoundingClientRect();
    const shift = centreShift(ink.top, ink.bottom, pr.top + 16, pr.bottom - 16);
    if (shift) layer.style.transform = `translateY(${shift}px)`;
    return;
  }
  const first = (osmd.GraphicSheet.MeasureList[0] as unknown as (OsmdMeasure | undefined)[] | undefined)?.[0];
  const lineY = first?.ParentStaffLine?.PositionAndShape.AbsolutePosition.y;
  if (lineY === undefined) return;
  const staffTop = svg.getBoundingClientRect().top + lineY * 10 * osmd.Zoom;
  const gap = staffTop - (panel.getBoundingClientRect().top + 16); // inside the panel's p-4
  if (gap > 0) layer.style.transform = `translateY(${-Math.round(gap * STRIP_LIFT)}px)`;
}

// The finger number written on each struck note of a step, by the key it lights.
// A note with no <fingering> gets no label, never a guess.
function fingersOf(notes: OsmdNote[] | undefined): Map<number, string> {
  const out = new Map<number, string>();
  for (const n of notes ?? []) {
    const finger = n.Fingering?.value?.trim();
    if (finger) out.set(toMidi(n), finger);
  }
  return out;
}

// The same, for the practice log: hand from the staff (top = right), only notes that carry a finger.
function writtenFingers(notes: OsmdNote[] | undefined): { note: number; finger: string; hand: 'L' | 'R' }[] {
  return (notes ?? []).flatMap((n) => {
    const finger = n.Fingering?.value?.trim();
    return finger ? [{ note: toMidi(n), finger, hand: (n.ParentStaff?.idInMusicSheet ?? 0) === 0 ? 'R' as const : 'L' as const }] : [];
  });
}

// Pixel box of every bar (all staves of one system), relative to its page's <svg>.
function barBoxes(osmd: OpenSheetMusicDisplay): Map<number, Band> {
  const boxes = new Map<number, Band>();
  const space = 10 * osmd.Zoom;
  const list = osmd.GraphicSheet.MeasureList as unknown as (OsmdMeasure | undefined)[][];
  list.forEach((staves, i) => {
    const shown = staves.flatMap((m) => (m?.PositionAndShape ? [m.PositionAndShape] : []));
    if (shown.length === 0) return;
    const top = shown[0];
    const bottom = shown[shown.length - 1];
    const x = top.AbsolutePosition.x + top.BorderLeft;
    const y = top.AbsolutePosition.y + top.BorderTop;
    boxes.set(i + 1, {
      x: x * space,
      y: y * space,
      w: (top.AbsolutePosition.x + top.BorderRight - x) * space,
      h: (bottom.AbsolutePosition.y + bottom.BorderBottom - y) * space,
    });
  });
  return boxes;
}

// #11354: "Bb" -> "B♭ major", "f" -> "F minor".
function keyTitle(name: string): string {
  const minor = name.charAt(0) === name.charAt(0).toLowerCase();
  const tonic = name.charAt(0).toUpperCase() + name.slice(1).replace('b', '♭').replace('#', '♯');
  return `${tonic} ${minor ? 'minor' : 'major'}`;
}

type Feedback =
  | { kind: 'idle' }
  | { kind: 'wrong'; played: number; expected: number[]; remaining: number[]; hint: string }
  | { kind: 'complete' };

// One band per line of music a run of steps crosses, for one hand (Hand zones and Block, #6086).
function bandsOf(
  placeOf: (step: number, h: 'L' | 'R') => { x: number; top: number } | null,
  space: number,
  steps: number[],
  h: 'L' | 'R',
  index: number,
): ZoneBand[] {
  const bands: ZoneBand[] = [];
  let run: { x0: number; x1: number; top: number } | null = null;
  const flush = () => {
    if (run) bands.push({ x: run.x0 - space, y: run.top - space, w: run.x1 - run.x0 + 2 * space, h: 6 * space, hand: h, index });
  };
  for (const st of steps) {
    const pl = placeOf(st, h);
    if (!pl) continue;
    if (run && Math.abs(pl.top - run.top) < 1 && pl.x >= run.x0) run.x1 = Math.max(run.x1, pl.x);
    else {
      flush();
      run = { x0: pl.x, x1: pl.x, top: pl.top };
    }
  }
  flush();
  return bands;
}

export function ScoreView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const followerRef = useRef<ScoreFollower | null>(null);
  const stepNotesRef = useRef<OsmdNote[][]>([]);
  const stepRestsRef = useRef<OsmdNote[][]>([]);
  const ringNotesRef = useRef<OsmdNote[][]>([]);
  const tieNotesRef = useRef<OsmdNote[][]>([]);
  // #5568: the step he just finished, whose ties a late re-strike still paints.
  const tieLeftRef = useRef<number | null>(null);
  const stepChordsRef = useRef<(StepChord | null)[]>([]);
  const stepRestRef = useRef<boolean[]>([]);
  // #9976: notices the pedal lifted before the next note (a gap in the sound).
  const pedalCoachRef = useRef(new PedalCoach());
  const [pedalTip, setPedalTip] = useState('');
  // #5560: stopped at the loop's edge by the wheel; a notch after a pause goes past it.
  const [edgeTip, setEdgeTip] = useState<{ x: number; y: number } | null>(null);
  const edgeRef = useRef({ from: -1, dir: 0, at: 0 });
  const edgeTipTimerRef = useRef<number | undefined>(undefined);
  const pedalTipTimerRef = useRef<number | undefined>(undefined);
  // #9988 tap-to-finger: the note he tapped, the message after, where to resume.
  const [fingerPick, setFingerPick] = useState<FingerPick | null>(null);
  // #10238: the one note the wheel edits. Yellow and the wheel both read this, so they can't disagree.
  const [wheelTarget, setWheelTarget] = useState<FingerTarget | null>(null);
  const [hoverKey, setHoverKey] = useState<number | null>(null);
  // Counts finished draws: a fingering save redraws without leaving 'ready'.
  const [drawn, setDrawn] = useState(0);
  // The piece the follower is built on; null while one is loading.
  const drawnPieceRef = useRef<string | null>(null);
  const [wheelLive, setWheelLive] = useState<{ x: number; y: number; target: FingerTarget; digit: Digit | null } | null>(null);
  const wheelPendingRef = useRef<{ pieceId: string; target: FingerTarget; digit: Digit | null } | null>(null);
  const wheelTimerRef = useRef<number | undefined>(undefined);
  const wheelAccRef = useRef({ at: 0, delta: 0, dir: 0 });
  const keyStripRef = useRef<HTMLDivElement>(null);
  const [fingerMsg, setFingerMsg] = useState('');
  // #5947: the note he just fingered; "apply to all matching" spreads its spot's whole fingering.
  const [spreadFrom, setSpreadFrom] = useState<{ target: FingerTarget; name: string } | null>(null);
  const resumeStepRef = useRef<number | null>(null);
  const liveSnapRef = useRef<SessionSnapshot | null>(null);
  // The snapshot a re-layout puts back, and the score last drawn (piece + xml) it must match.
  const relayoutSnapRef = useRef<SessionSnapshot | null>(null);
  const loadedRef = useRef<{ pieceId: string; xml: string | undefined; layout: string } | null>(null);
  // #10134: the loop he had set when a fingering edit re-rendered the score.
  const resumeLoopRef = useRef<{ first: number; last: number } | null>(null);
  // The chord symbol in force where he is playing, the keys struck under it, and
  // whether they now cover it (then the symbol is green).
  const chordLitRef = useRef(noChord());
  const lapStartRef = useRef<number | null>(null);
  // #5519 training wheels: the bar his run started in, his step pace, and a hesitation.
  const runStartBarRef = useRef<number | null>(null);
  const lastAdvanceRef = useRef<number | null>(null);
  const stepGapsRef = useRef<number[]>([]);
  const hesitateTimerRef = useRef<number | undefined>(undefined);
  const [hesitating, setHesitating] = useState(false);
  // #5521: the clean-lap glow wave; `key` remounts the overlay to replay it.
  const [wave, setWave] = useState<{ key: number; dots: WaveDot[]; peak: number } | null>(null);
  const waveTimersRef = useRef<number[]>([]);
  // Expression telemetry (#9569): how he plays the marked dynamics and tempo
  // changes. Report-only: it never gates the follower or turns anything red.
  const exprRef = useRef<ExpressionTracker | null>(null);
  // Set at a loop wrap: the next lap starts a fresh pass on its first note, so a
  // fermata on the lap's last note can still be timed by its release.
  const exprNewPassRef = useRef(false);
  const [exprMarks, setExprMarks] = useState<string[]>([]);
  const [exprFindings, setExprFindings] = useState<string[]>([]);
  const cursorIndexRef = useRef(0);
  const flashTimerRef = useRef<number | undefined>(undefined);
  const watchTimerRef = useRef<number | undefined>(undefined);
  const watchRunRef = useRef(0);
  const watchBpmRef = useRef<number | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  // The white score panel; in the strip layout it is the sideways scroller.
  const panelRef = useRef<HTMLDivElement>(null);
  const [cursorStep, setCursorStep] = useState(0);
  const markIdRef = useRef(0);
  const [marks, setMarks] = useState<PlayedMark[]>([]);

  const [pieceId, setPieceId] = useState(PIECES[0].id);
  // #10160: the piece he had last time, picked once the Pieces folder has been read.
  const [startResolved, setStartResolved] = useState(false);
  // 'photo': a pushed piece with no readable score yet, only its photo to show.
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'photo'>('loading');
  const [view, setView] = useState<'score' | 'photo'>('score');
  const [hand, setHand] = useState<'both' | 'right' | 'left'>('both');
  // #5624: bumped whenever the step lists are rebuilt (a hand switch, a reload).
  const [stepsVersion, setStepsVersion] = useState(0);
  const handRef = useRef(hand);
  const [staffCount, setStaffCount] = useState(0);
  const [openError, setOpenError] = useState('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [following, setFollowing] = useState(true);
  const [watching, setWatching] = useState(false);
  /** #5652 C: how many note groups Read ahead has blanked right now (for tests and live checks). */
  const [blanked, setBlanked] = useState(0);
  // Keep going (#5652 K): the cursor runs on the beat; his notes are tallied, nothing waits.
  const [keep, setKeep] = useState<{ bpm: number; lap: number; count: number; hit: number; wrong: number } | null>(null);
  // #6530 C: climb = the tempo climb riding on this run; roland = the piano's own metronome is clicking.
  const keepRef = useRef<{
    run: KeepRun; timer: number; beat: number; step: number;
    climb: Climb | null; climbKey: string; roland: boolean; rolandOn: boolean;
    /** #6530 D: [Play it slower] clicks even with the click setting off. */
    click: boolean;
  } | null>(null);
  const keepStartingRef = useRef(false);
  const [climb, setClimb] = useState<Climb | null>(null);
  const climbCarryRef = useRef<{ key: string; climb: Climb } | null>(null);
  // A reload or quit mid-run must not leave the piano clicking.
  useEffect(() => {
    const off = () => { if (keepRef.current?.rolandOn) rolandOffNow(); };
    window.addEventListener('beforeunload', off);
    return () => window.removeEventListener('beforeunload', off);
  }, []);
  const climbOn = useSettingsStore((s) => s.climbOn);
  const [keepBpm, setKeepBpm] = useState(60);
  const [keepLast, setKeepLast] = useState<string | null>(null);
  const keeping = keep !== null;
  const [watchNotes, setWatchNotes] = useState<number[]>([]);
  const held = useMidiStore((s) => s.held);
  const showKeyboard = useSettingsStore((s) => s.showKeyboard);
  const setShowKeyboard = useSettingsStore((s) => s.setShowKeyboard);
  const trainingWheels = useSettingsStore((s) => s.trainingWheels);
  const reverseWheel = useSettingsStore((s) => s.reverseWheel);
  const wheelSteps = useSettingsStore((s) => s.wheelSteps);
  const setWheelSteps = useSettingsStore((s) => s.setWheelSteps);
  // #6369: the strip's wheel slid the music away from his place; the next note brings it back.
  const [looking, setLooking] = useState(false);
  const lookingRef = useRef(false);
  lookingRef.current = looking;
  // #5630: off, the wheel over the score never edits a finger; over a key it still does.
  const scoreWheelFingers = useSettingsStore((s) => s.scoreWheelFingers);
  const keyWheelFingers = useSettingsStore((s) => s.keyWheelFingers);
  const everyBarNumbers = useSettingsStore((s) => s.everyBarNumbers);
  const stripFitInk = useSettingsStore((s) => s.stripFitInk);
  const setReverseWheel = useSettingsStore((s) => s.setReverseWheel);
  const [remaining, setRemaining] = useState<number[]>([]);
  const [playHint, setPlayHint] = useState('');
  // Every key of the step stays lit on the strip, credited or not (#9993).
  const [stepKeys, setStepKeys] = useState<number[]>([]);
  const [measure, setMeasure] = useState(1);
  const [feedback, setFeedback] = useState<Feedback>({ kind: 'idle' });
  const [wrongCount, setWrongCount] = useState(0);
  // #11354: read by the MIDI handler, whose closure would see a stale count.
  const wrongCountRef = useRef(0);
  // #11354: the fresh tune on screen, if any (see freshTune below).
  const freshRef = useRef<{ id: string; key: string; label: string } | null>(null);
  // #11354 item 3: five minutes on this piece with every hint off (see startBareRun).
  const [bare, setBare] = useState<BareRun | null>(null);
  // #11354 item 4: hand zones on the score (see the effect by startBlock).
  const [zonesOn, setZonesOn] = useState(false);
  // A finger swapped in place (no re-layout) can still move a position boundary.
  const [zoneTick, setZoneTick] = useState(0);
  const [zones, setZones] = useState<{ bands: ZoneBand[]; marks: ZoneMark[]; right: number; left: number; shifts: Shift[] } | null>(null);
  // #11354 item 6: who stays and who moves from chord to chord (see the effect after hand zones).
  const [chordsOn, setChordsOn] = useState(false);
  const [chords, setChords] = useState<{ rings: ChordRing[]; tags: ChordTag[]; changes: number; kept: number; same: number; shifts: number } | null>(null);
  const bareRef = useRef<BareRun | null>(null);
  const [bareLeft, setBareLeft] = useState(0);
  const [bareMsg, setBareMsg] = useState('');
  const bumpBare = useCallback((fn: (r: BareRun) => BareRun) => {
    const r = bareRef.current;
    if (!r || r.pieceId !== drawnPieceRef.current) return;
    bareRef.current = fn(r);
    setBare(bareRef.current);
  }, []);
  wrongCountRef.current = wrongCount;
  const [pace, setPace] = useState<number | null>(null);
  const [wrongFlash, setWrongFlash] = useState(false);
  // Loop range (#5004): 'start'/'end' while he is clicking bars to set it.
  const [picking, setPicking] = useState<'off' | 'start' | 'end'>('off');
  const [pickStart, setPickStart] = useState<number | null>(null);
  const [loopBars, setLoopBars] = useState<{ first: number; last: number } | null>(null);
  // #6369: the range a spin over the range boxes is showing, shaded before it lands.
  const [previewBars, setPreviewBars] = useState<{ first: number; last: number } | null>(null);
  const [lap, setLap] = useState(1);
  const [lapBpm, setLapBpm] = useState<number | null>(null);
  // Build backwards (#10133): the loop runs chunk.start..chunk.last and grows a bar at a time.
  const [chunk, setChunk] = useState<ChunkState | null>(null);
  const chunkRef = useRef<ChunkState | null>(null);
  // #6530 F: the guided lesson plan (per session). Its loop moves never touch his saved loop or spots.
  const [lesson, setLesson] = useState<LessonState | null>(null);
  const lessonRef = useRef<LessonState | null>(null);
  const putLesson = (l: LessonState | null) => {
    lessonRef.current = l;
    setLesson(l);
  };
  // The plan ends without moving the loop (whatever ends it sets its own).
  const endLesson = (why: string) => {
    if (!lessonRef.current) return;
    reportEvent('lesson', { on: false, why, at: lessonRef.current.at });
    putLesson(null);
  };
  chunkRef.current = chunk;
  // #5657c blocking: his loop pressed one hand position at a time, as a chord, no timing.
  const [block, setBlockState] = useState<BlockState | null>(null);
  // #6086: Block's how-to card; opens by itself the first time he turns Block on.
  const [blockTipOpen, setBlockTipOpen] = useState(false);
  const [blockBands, setBlockBands] = useState<ZoneBand[] | null>(null);
  const blockTipRef = useRef(false);
  blockTipRef.current = blockTipOpen;
  const blockRef = useRef<BlockState | null>(null);
  const setBlock = useCallback((b: BlockState | null) => {
    blockRef.current = b;
    setBlockState(b);
  }, []);
  // #5382: the whole range hit its clean-lap target. The loop stops until he restarts.
  const [reached, setReached] = useState<string | null>(null);
  const [grewTip, setGrewTip] = useState('');
  const grewTipTimerRef = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(grewTipTimerRef.current), []);
  // The whole range he chose; with Build backwards the loop itself is only the end of it.
  const overall = chunk ? { first: chunk.first, last: chunk.last } : loopBars;
  const lapWrongRef = useRef(0);
  // #6460 trouble spots: bars with a miss in this lap; a scroll skip voids the lap for spots.
  const lapWrongBarsRef = useRef(new Set<number>());
  const lapSkippedRef = useRef(false);
  const missLogRef = useRef(new Map<string, number[]>());
  const lapsSinceSpotCheckRef = useRef(0);
  // #6530 D/E: the tutor's own advice. A banner found after a lap waits for a pause to show.
  const [advice, setAdvice] = useState<AdviceCard | null>(null);
  const pendingAdviceRef = useRef<{ card: AdviceCard; piece: string; loop: string; at: number } | null>(null);
  // #6530 E: what the rules learn from this loop (or whole-piece run): each lap's miss bars,
  // whether he paused before each bar, each credited note's velocity. A new piece or loop starts afresh.
  const adviceDataRef = useRef({ key: '', laps: [] as number[][], entries: new Map<number, boolean[]>(), vel: [] as VelSample[], velLap: 0, prev: null as { bar: number; beat: number; at: number } | null, perBeat: [] as number[], lapCount: 0 });
  const adviceShownAtRef = useRef<number | null>(null);
  // e2e scripts set window.__adviceNoGap = true to see several banners in one run (e2e_advice_rules.py).
  const lastAdviceAt = () => ((window as unknown as { __adviceNoGap?: boolean }).__adviceNoGap ? null : adviceShownAtRef.current);
  const lapsSinceAdviceRef = useRef(0);
  const keepLapsSinceAdviceRef = useRef(0);
  const checkAdviceRef = useRef<(bars: { first: number; last: number }, kind: 'lap' | 'pass' | 'keep') => void>(() => {});
  const spotPassRef = useRef<() => void>(() => {});
  const checkSpotsRef = useRef<(range: { first: number; last: number }) => void>(() => {});
  const [spotTip, setSpotTip] = useState('');
  const spotTipTimerRef = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(spotTipTimerRef.current), []);
  // #5945: opened at each loop wrap; notes played on past the loop's end are overruns.
  const overrunRef = useRef<Overrun | null>(null);
  // #5799: every wrong key thuds (keys within MISS_FLOOR_MS of the last thud share it).
  const lastMissAtRef = useRef(Number.NEGATIVE_INFINITY);
  const thudMiss = useCallback((): Promise<string> | undefined => {
    const now = performance.now();
    if (!useSettingsStore.getState().missSound || !missGateOpen(lastMissAtRef.current, now)) return undefined;
    lastMissAtRef.current = now;
    return playMissSound(useSettingsStore.getState().missVolume, useSettingsStore.getState().missKind);
  }, []);
  // #5566: a wrong note or a stray spoils the lap.
  const spoilLap = useCallback((bar?: number) => {
    const first = lapWrongRef.current++ === 0;
    // #6460: which bars this lap's misses hit, and when (a removed spot comes back if it gets bad again).
    if (bar !== undefined) {
      lapWrongBarsRef.current.add(bar);
      const key = `${pieceLabelRef.current}#${bar}`;
      const log = missLogRef.current.get(key) ?? [];
      log.push(Date.now());
      missLogRef.current.set(key, log);
    }
    const sound = useSettingsStore.getState().missSound;
    const played = thudMiss();
    // #11561: say what the audio context was doing, so "didn't hear it" can be told apart from "never played".
    if (played) void played.then((audio) => reportEvent('lap-spoiled', { sound, audio, first }));
    else if (first) reportEvent('lap-spoiled', { sound, audio: undefined, first });
  }, [thudMiss]);
  const missSound = useSettingsStore((s) => s.missSound);
  const missVolume = useSettingsStore((s) => s.missVolume);
  const missKind = useSettingsStore((s) => s.missKind);
  const backwardTargets = useSettingsStore((s) => s.backwardTargets);
  const pieceStars = useSettingsStore((s) => s.pieceStars);
  const spotMerges = useSettingsStore((s) => s.spotMerges);
  const allSpots = useSettingsStore((s) => s.troubleSpots);
  const spotClean = useSettingsStore((s) => s.spotClean);
  const setBackwardTargets = useSettingsStore((s) => s.setBackwardTargets);
  const [bands, setBands] = useState<Band[]>([]);
  const [layoutTick, setLayoutTick] = useState(0);
  const loopRequest = useTutorStore((s) => s.loopRequest);
  const scoreLayout = useSettingsStore((s) => s.scoreLayout);
  const setScoreLayout = useSettingsStore((s) => s.setScoreLayout);
  const strip = scoreLayout === 'strip';
  const stripRef = useRef(strip);
  stripRef.current = strip;
  const layoutRef = useRef(scoreLayout);
  layoutRef.current = scoreLayout;
  const togglePages = useSettingsStore((s) => s.togglePages);

  // #10236 seamless relaunch: read what to put back before the first piece loads, since the
  // hand decides the steps. Taken once, by the first load of that same piece; a tutor push
  // or homework line in the meantime is a different piece and wins.
  const restoreRef = useRef<SessionSnapshot | null>(null);
  const [sessionRead, setSessionRead] = useState(false);
  useEffect(() => {
    let gone = false;
    void loadStartupSnapshot().then((snap) => {
      if (gone) return;
      // A tutor push or homework line got here first: that's what he's on now.
      const { selectPieceId, pieceRequest } = useTutorStore.getState();
      if (snap && !selectPieceId && !pieceRequest) {
        restoreRef.current = snap;
        handRef.current = snap.hand;
        setHand(snap.hand);
        setFollowing(snap.following);
        setShowOriginal(snap.showOriginal);
      }
      setSessionRead(true);
    });
    return () => {
      gone = true;
    };
  }, []);

  // Built-in pieces, his Pieces folder on disk, then anything pushed this session.
  // The folder is re-read when the window regains focus, so a synced file shows up.
  const [folder, setFolder] = useState<Piece[]>([]);
  const [folderLoaded, setFolderLoaded] = useState(false);
  // Re-read the folder now (after a mix is saved), whatever it looked like before.
  const reloadFolderRef = useRef<(() => Promise<void>) | undefined>(undefined);
  useEffect(() => {
    const list = window.tutorBridge?.listPieces;
    if (!list) {
      setFolderLoaded(true);
      return;
    }
    let lastKey = '';
    const refresh = () =>
      list()
        .then((files) => {
          const key = files
            .map((f) => `${f.file}:${f.musicxml.length}:${f.trust?.status}:${f.trust?.note}:${f.group?.slug}:${f.group?.label}:${JSON.stringify(f.group?.mix?.choice)}`)
            .join('|');
          if (key === lastKey) return;
          lastKey = key;
          setFolder(
            files.map((f) => ({
              id: `file:${f.file}`,
              label: f.group?.title ?? f.title,
              xml: f.musicxml,
              trust: f.trust,
              group: f.group,
            })),
          );
        })
        .catch((err) => console.warn('[pieces] list failed:', err))
        .finally(() => setFolderLoaded(true));
    reloadFolderRef.current = () => {
      lastKey = '';
      return refresh();
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  const pushed = useTutorStore((s) => s.pieces);
  const selectPieceId = useTutorStore((s) => s.selectPieceId);
  // A pushed score is also saved to the folder; list it once.
  const pushedLabels = new Set(pushed.map((p) => p.label));
  const favorites = useSettingsStore((s) => s.favoritePieces);
  const toggleFavorite = useSettingsStore((s) => s.toggleFavoritePiece);
  const allPieces: Piece[] = [...PIECES, ...folder.filter((p) => !pushedLabels.has(p.label)), ...pushed];
  // A song with versions (#9627) is listed once: the version on screen, else the one
  // he last switched to, else its first (Easy).
  const pieceVersions = useSettingsStore((s) => s.pieceVersions);
  const setPieceVersion = useSettingsStore((s) => s.setPieceVersion);
  const versionsOf = (slug: string) =>
    allPieces
      .filter((p): p is Piece & { group: PieceGroupRef } => p.group?.slug === slug)
      .sort((a, b) => a.group.index - b.group.index);
  const onScreen = allPieces.find((p) => p.id === pieceId);
  const shownVersion = (slug: string) => {
    if (onScreen?.group?.slug === slug) return onScreen.id;
    const versions = versionsOf(slug);
    return (versions.find((p) => p.id === `file:${pieceVersions[slug]}`) ?? versions[0]).id;
  };
  // Favorites first (#9610), then everything else; both halves in title order.
  const pieces: Piece[] = allPieces
    .filter((p) => !p.group || p.id === shownVersion(p.group.slug))
    .sort((a, b) => Number(favorites.includes(b.label)) - Number(favorites.includes(a.label)) || byTitle(a, b));
  const favoritePieces = pieces.filter((p) => favorites.includes(p.label));
  const otherPieces = pieces.filter((p) => !favorites.includes(p.label));
  // #5259: "★ only" shortens the list to his favorites, plus the piece on screen so it stays selected.
  const favoritesOnly = useSettingsStore((s) => s.favoritesOnly);
  const setFavoritesOnly = useSettingsStore((s) => s.setFavoritesOnly);
  const listedOthers = favoritesOnly && favoritePieces.length ? otherPieces.filter((p) => p.id === pieceId) : otherPieces;
  useEffect(() => {
    if (!selectPieceId) return;
    setPieceId(selectPieceId);
    setStartResolved(true);
  }, [selectPieceId]);
  // Missing (deleted or renamed): today's default, quietly.
  const restoreSnap = restoreRef.current;
  const startChoice = startResolved
    ? pieceId
    : !sessionRead
      ? 'wait'
      : resolvePieceId(
          restoreSnap ? { id: restoreSnap.pieceId, label: restoreSnap.pieceLabel } : useSettingsStore.getState().lastPiece,
          allPieces, folderLoaded, PIECES[0].id,
        );
  useEffect(() => {
    if (startResolved || startChoice === 'wait') return;
    setPieceId(startChoice);
    setStartResolved(true);
  }, [startResolved, startChoice]);
  const setLastPiece = useSettingsStore((s) => s.setLastPiece);
  useEffect(() => {
    if (startResolved && onScreen) setLastPiece(rememberRef(onScreen.id, onScreen.label, !!onScreen.xml));
  }, [startResolved, onScreen?.id, onScreen?.label, setLastPiece]);
  // #9988: his fingering edits this session, by piece id (the file is saved too).
  const [xmlEdits, setXmlEdits] = useState<Record<string, string>>({});
  const listed = onScreen ?? PIECES[0];
  const piece = xmlEdits[listed.id] ? { ...listed, xml: xmlEdits[listed.id] } : listed;
  const versions = piece.group ? versionsOf(piece.group.slug) : [];
  // My mix (#9627): the builder needs both source scores loaded.
  const [mixing, setMixing] = useState(false);
  const mixPlan = piece.group?.mix;
  const easyPiece = mixPlan && allPieces.find((p) => p.id === `file:${mixPlan.easy}`);
  const harderPiece = mixPlan && allPieces.find((p) => p.id === `file:${mixPlan.harder}`);
  const hasMix = versions.some((v) => v.group.label === 'My mix');
  const saveMix = async (choice: MixChoice[], musicxml: string, trust: PieceTrust) => {
    if (!piece.group || !mixPlan || !window.tutorBridge?.saveMix) throw new Error("Can't save a mix here.");
    const { slug } = piece.group;
    const { file } = await window.tutorBridge.saveMix(slug, { harder: mixPlan.harder, choice, musicxml, trust });
    await reloadFolderRef.current?.();
    setPieceId(`file:${file}`);
    setPieceVersion(slug, file);
    setMixing(false);
  };
  const pieceName = piece.group ? `${piece.label} (${piece.group.label})` : piece.label;
  const pieceNameRef = useRef(pieceName);
  pieceNameRef.current = pieceName;
  // #6530 D: which loop is set now (an advice banner found for another loop is dropped).
  const loopKeyOf = () => {
    const r = followerRef.current?.range;
    return r ? `${r.first}-${r.last}` : 'none';
  };
  // #6530 E/F: one lap of this loop ended: its miss bars (a scroll-skipped lap doesn't count).
  const noteAdviceLap = () => {
    const d = adviceData();
    if (!lapSkippedRef.current) d.laps = [...d.laps.slice(-5), [...lapWrongBarsRef.current]];
    d.velLap++;
    d.lapCount++;
    d.prev = null;
  };
  const adviceData = () => {
    const key = `${pieceNameRef.current}|${loopKeyOf()}`;
    if (adviceDataRef.current.key !== key) {
      adviceDataRef.current = { key, laps: [], entries: new Map(), vel: [], velLap: 0, prev: null, perBeat: [], lapCount: 0 };
    }
    return adviceDataRef.current;
  };
  const pieceSpots: Spot[] = own(allSpots, piece.label); // #6460
  // #6530 F: the Lesson plan button turns on after this many laps of this loop, however they went.
  const lessonReady = !!loopBars && adviceDataRef.current.key === `${pieceName}|${loopKeyOf()}` &&
    adviceDataRef.current.lapCount >= LESSON_MIN_LAPS;
  const freshNow = freshRef.current?.label === piece.label ? freshRef.current : null;
  // #11354: hints start off on a new piece (fresh tune, sight-read pick), and stay off in a bare run.
  const hintsOffNew = useSettingsStore((s) => s.hintsOffNew);
  const sightReadPiece = useSettingsStore((s) => s.sightReadPiece);
  const bareNow = bare?.pieceId === piece.id ? bare : null;
  const quietNew = hintsOffNew && (!!freshNow || sightReadPiece === piece.id);
  // #5652 C Read ahead (experimental): the notes at the cursor blank out, and no hint names them.
  const readAhead = useSettingsStore((s) => s.readAhead);
  const hintsOff = !!bareNow || quietNew || readAhead;
  // #5259: a homework line opens its piece and starts on the range he last set there.
  const pieceRequest = useTutorStore((s) => s.pieceRequest);
  const [pendingOpen, setPendingOpen] = useState<{ pieceId: string; backwards: boolean } | null>(null);
  useEffect(() => {
    if (!pieceRequest) return;
    const found = allPieces.some((p) => p.id === pieceRequest.pieceId);
    if (!found && !folderLoaded) return;
    useTutorStore.getState().clearPieceRequest();
    if (!found) {
      setFingerMsg(`Couldn't find that piece's file (${pieceRequest.pieceId.replace(/^file:/, '')}).`);
      return;
    }
    setPieceId(pieceRequest.pieceId);
    setStartResolved(true);
    setPendingOpen(pieceRequest);
  }, [pieceRequest, folderLoaded, folder]);
  // #9988: the scanned original, for pieces with a scan layout (library slug = file stem).
  const scanSlug = piece.id.startsWith('file:')
    ? piece.id.slice(5).replace(/\.(musicxml|xml|mxl)$/i, '')
    : /^[a-z0-9][a-z0-9-]*$/.test(piece.label) ? piece.label : null;
  const scanLayout = useScanLayout(scanSlug);
  // #5723: print for his binder; #6083: preview first, and an unverified score warns instead of blocking.
  const [printing, setPrinting] = useState(false);
  const [printNote, setPrintNote] = useState('');
  useEffect(() => setPrintNote(''), [piece.id]);
  const [binderPreview, setBinderPreview] = useState<BinderPreviewData | null>(null);
  useEffect(() => setBinderPreview(null), [piece.id]);
  // #6083: the click only renders and shows the preview; nothing prints until Print inside it.
  const printForBinder = async () => {
    const bridge = window.tutorBridge;
    if (!scanSlug || !bridge?.binderInfo || !bridge.printBinder) return;
    setPrinting(true);
    setPrintNote('');
    try {
      const info = await bridge.binderInfo(scanSlug);
      const { html, pages } = await renderBinderHtml({ musicxml: piece.xml, title: piece.label, pageStarts: info.pageStarts });
      const verified = piece.trust?.status === 'verified';
      setBinderPreview({ html, pages, confirmed: info.confirmed, total: info.total, verified, pageStarts: info.pageStarts });
      reportEvent('binder_print', { piece: scanSlug, preview: true, pages, ...(verified ? {} : { warned: 'unverified', confirmed: info.confirmed, total: info.total }) });
    } catch (err) {
      setPrintNote(`Print failed: ${(err as Error).message}`);
    } finally {
      setPrinting(false);
    }
  };
  const confirmBinderPrint = async () => {
    const bridge = window.tutorBridge;
    if (!scanSlug || !bridge?.printBinder || !binderPreview) return;
    setPrinting(true);
    try {
      const out = await bridge.printBinder(scanSlug, binderPreview.html);
      const { pages } = binderPreview;
      // #6090: only say "Sent" when the Mac queued a real job; a failure throws and lands in the catch below.
      const to = out.sent ? ` Sent to ${out.sent.printer}, two-sided (job ${out.sent.job}).` : '';
      setPrintNote(`${pages} page${pages === 1 ? '' : 's'}, ${pages * 2} sides (two-sided).${to} Saved ${out.pdf}`);
      reportEvent('binder_print', { piece: scanSlug, pages, sides: pages * 2, pdf: out.pdf, ...(binderPreview.verified ? {} : { unverified: true }) });
      setBinderPreview(null);
    } catch (err) {
      setPrintNote(`Print failed: ${(err as Error).message}`);
      setBinderPreview(null);
    } finally {
      setPrinting(false);
    }
  };
  // #6584: the same pages, each once on one side, saved as a PDF file for his teacher. Never printed or sent.
  const saveBinderPdf = async () => {
    const bridge = window.tutorBridge;
    if (!scanSlug || !bridge?.savePagesPdf || !binderPreview) return;
    setPrinting(true);
    try {
      const { html, pages } = await renderBinderHtml({
        musicxml: piece.xml, title: piece.label, pageStarts: binderPreview.pageStarts ?? [], sides: 'single',
      });
      const out = await bridge.savePagesPdf(scanSlug, html);
      setPrintNote(`PDF for your teacher: ${pages} page${pages === 1 ? '' : 's'}, one side each. Saved ${out.pdf}`);
      reportEvent('binder_pdf', { piece: scanSlug, pages, pdf: out.pdf, ...(binderPreview.verified ? {} : { unverified: true }) });
    } catch (err) {
      setPrintNote(`Save as PDF failed: ${(err as Error).message}`);
    } finally {
      setPrinting(false);
      setBinderPreview(null);
    }
  };
  const cancelBinderPrint = () => {
    reportEvent('binder_print_cancel', { piece: scanSlug });
    setBinderPreview(null);
  };
  const [showOriginal, setShowOriginal] = useState(false);
  // #10258: what's drawn. A finger edit changes piece.xml but has already changed the drawing in
  // place, so it leaves this alone and nothing downstream reloads the score.
  const quietXmlRef = useRef<string | null>(null);
  const drawnXmlRef = useRef(piece.xml);
  if (piece.xml !== quietXmlRef.current) {
    quietXmlRef.current = null;
    drawnXmlRef.current = piece.xml;
  }
  const drawnXml = drawnXmlRef.current;
  // Any reload (a new layout, say) must load his latest marks, not the ones it was drawn with.
  const latestXmlRef = useRef(piece.xml);
  latestXmlRef.current = piece.xml;
  const fifths = useMemo(() => fifthsOf(piece.xml), [piece.xml]);
  // #6530 B: the tempo the score marks (a bundled piece's own target wins), on screen and in lap/pass events.
  // Only a bundled target caps Keep going: a MIDI import's mark is often just the file's default 120.
  const markedBpm = useMemo(() => piece.targetBpm ?? markedTempo(piece.xml), [piece.targetBpm, piece.xml]);
  const markedBpmRef = useRef(markedBpm);
  markedBpmRef.current = markedBpm;
  // #6530 C: a tempo JP set for this piece in his homework notes ("♩ = 80"), the climb's default target.
  const [homeworkBpm, setHomeworkBpm] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    setHomeworkBpm(null);
    const file = piece.id.startsWith('file:') ? piece.id.slice(5) : null;
    if (!file) return;
    void window.tutorBridge?.getHomework?.().then((hw) => {
      const item = hw?.items.find((i) => i.kind === 'piece' && (i.file === file || i.files?.includes(file)));
      if (live && item) setHomeworkBpm(parseTempo([item.label, ...(item.notes ?? [])].join(' ')));
    }).catch(() => {});
    return () => { live = false; };
  }, [piece.id]);
  const climbTarget = useSettingsStore((s) => s.climbTargets[piece.label]) ?? homeworkBpm ?? markedBpm ?? clampBpm(keepBpm + 20);
  // JP 10/9 "Key first": a new piece (fresh tune, sight-read pick) opens with its key signature's
  // sharps or flats to play before the score takes notes. Armed once per piece.
  const [keyGateNow, setKeyGateState] = useState<KeyGate | null>(null);
  const keyGateRef = useRef<KeyGate | null>(null);
  const setKeyGate = useCallback((g: KeyGate | null) => {
    keyGateRef.current = g;
    setKeyGateState(g);
  }, []);
  const keyGateForRef = useRef<string | null>(null);
  // The last key the gate took, so the follower never also judges it (listener order isn't fixed).
  const keyGateEvRef = useRef<unknown>(null);
  const keyFirst = useSettingsStore((s) => s.keyFirst);
  useEffect(() => {
    if (keyGateForRef.current === piece.id) {
      if (!keyFirst && keyGateRef.current) setKeyGate(null);
      return;
    }
    if (keyGateRef.current) setKeyGate(null);
    if (!quietNew || !keyFirst) return;
    keyGateForRef.current = piece.id;
    const g = keyGate(fifths);
    setKeyGate(g);
    if (g) reportEvent('key-first', { event: 'asked', fifths });
  }, [piece.id, quietNew, keyFirst, fifths, setKeyGate]);
  const pieceLabelRef = useRef(piece.label);
  pieceLabelRef.current = piece.label;
  // #5948: a pause never carries over to another piece.
  useEffect(() => {
    useMidiStore.getState().setPaused(false);
    setSpreadFrom(null); // #5947: the note he just fingered belongs to the old piece
  }, [piece.id]);
  // #5948: Keep going's clock doesn't wait, so pausing ends the run (restart clears a pause; put it back).
  const paused = useMidiStore((s) => s.pausedAt !== null);
  useEffect(() => {
    if (paused && keepRef.current) {
      restart();
      useMidiStore.getState().setPaused(true);
    }
  }, [paused]); // eslint-disable-line react-hooks/exhaustive-deps

  // Name notes as the page spells them: the written notes at the cursor first, then
  // the key signature, so a 4-flat piece says "Db5", never "C#5".
  const noteName = useCallback(
    (midi: number) => {
      const f = followerRef.current;
      const stepNotes = f ? (stepNotesRef.current[Math.min(f.index, f.steps.length - 1)] ?? []) : [];
      const written = stepNotes.map(writtenOf).filter((w): w is WrittenNote => w !== null);
      return writtenName(spellPlayed(midi, fifths, written));
    },
    [fifths],
  );
  const namesOf = (midis: number[]) => [...midis].sort((a, b) => b - a).map(noteName).join(' + ');

  // Tell the tutor API what is on screen, so personas can ask "where is he?".
  const pieceLabels = pieces.map((p) => p.label).join('\n');
  useEffect(() => {
    reportScreen({
      piece: pieceName,
      pieces: pieceLabels.split('\n'),
      status,
      hand,
      measure,
      keep: keep ? { ...keep, last: keepLast } : keepLast ? { last: keepLast } : null,
      remaining: remaining.map(noteName),
      wrongCount,
      feedback:
        feedback.kind === 'wrong'
          ? {
              kind: 'wrong',
              played: noteName(feedback.played),
              expected: feedback.expected.map(noteName),
              remaining: feedback.remaining.map(noteName),
              hint: feedback.hint,
            }
          : feedback,
      paceBpm: pace,
      loop: loopBars ? { firstBar: loopBars.first, lastBar: loopBars.last, lap, lastLapBpm: lapBpm } : null,
      markedBpm,
      climb: climb ? { ...climb, percent: climbPercent(climb) } : null,
      climbTarget,
      backwards: chunk
        ? { firstBar: chunk.first, lastBar: chunk.last, startBar: chunk.start, endBar: loopEnd(chunk), outward: chunk.out === true,
            clean: chunk.clean, need: chunk.need, done: chunk.done, reached: reached !== null }
        : null,
      // #5657c: blocking on his loop, one hand position at a time.
      block: block
        ? (() => {
            const pos = block.positions[block.at];
            return {
              position: block.at + 1, of: block.positions.length, firstBar: pos.firstBar, lastBar: pos.lastBar,
              keys: pos.keys.map(noteName), fingers: pos.fingers.map((n) => `${n.hand}${n.finger ?? '?'}`),
              clean: block.clean, need: block.need, armed: block.armed, spoiled: block.spoiled, done: block.done,
            };
          })()
        : null,
      handZones: zones
        ? { right: zones.right, left: zones.left, bands: zones.bands.length, shifts: zones.shifts.map((z) => ({ hand: z.hand, bar: z.bar, semitones: z.semitones })) }
        : null,
      chordMoves: chords
        ? { changes: chords.changes, kept: chords.kept, same: chords.same, shifts: chords.shifts, rings: chords.rings.length }
        : null,
      spots: pieceSpots.map((sp) => ({
        first: sp.first, last: sp.last, alone: sp.alone, inContext: sp.inContext, ticked: sp.ticked ?? null, auto: sp.auto === true,
      })),
      // #6531: his starred ranges for this piece, and the layout on screen.
      stars: starsInOrder(starsOf(pieceStars, piece.label)),
      scoreLayout,
      pickingLoop: picking === 'off' ? null : picking,
      playedMarks: marks.length,
      wrongMarks: marks.filter((m) => m.wrong).length,
      redAccidentals: marks.flatMap((m) => (m.accidental ? [m.accidental] : [])),
      expressionMarks: exprMarks.slice(0, 40),
      expression: exprFindings,
      // #5652 C: Read ahead on, and how many note groups are blanked at the cursor now.
      readAhead: readAhead ? { blanked } : null,
      // #6530 D: the advice banner on screen.
      advice: advice ? { ...advice.data, rule: advice.rule, text: advice.text, sub: advice.sub ?? null, action: advice.action ?? null } : null,
      // #6530 F: the lesson plan, and whether its button is on.
      lesson: lesson ? { main: lesson.main, steps: lesson.steps, at: lesson.at, clean: lesson.clean, need: lesson.steps[lesson.at].need } : null,
      lessonReady,
    });
  }, [advice, lesson, lessonReady, pieceName, pieceLabels, status, hand, measure, keep, keepLast, remaining, wrongCount, feedback, pace, marks, noteName, loopBars, lap, lapBpm, picking, exprMarks, exprFindings, chunk, reached, block, zones, chords, readAhead, blanked, pieceSpots, pieceStars, scoreLayout, markedBpm, climb, climbTarget]);

  // Where a played note goes: x from the written notehead(s) at that step, y
  // from the staff's top line plus the diatonic offset of the played pitch,
  // spelled against the key and what is written there.
  const placePlayed = useCallback(
    (stepIdx: number, midi: number, wrong: boolean, anchor?: OsmdNote): PlayedMark | null => {
      const osmd = osmdRef.current;
      const layer = layerRef.current;
      const step = followerRef.current?.steps[stepIdx];
      const stepNotes = stepNotesRef.current[stepIdx] ?? [];
      const ringNotes = ringNotesRef.current[stepIdx] ?? [];
      const container = containerRef.current;
      if (!osmd || !layer || !step || !container || (stepNotes.length === 0 && !anchor)) return null;
      const svg = pageSvgOf(osmd, container, step.measure - 1);
      if (!svg) return null;
      try {
        const staves = osmd.Sheet.Staves.length;
        // Which staff: the one this pitch is written on here; else the staff of the
        // nearest written note. Pitch alone fails with two treble staves (#9481).
        // Held-over notes count only on an exact match; "nearest" uses the notes struck here.
        const candidates = [...stepNotes, ...ringNotes];
        const exact = anchor ?? candidates.find((n) => toMidi(n) === midi);
        const nearest = [...stepNotes].sort((a, b) => Math.abs(toMidi(a) - midi) - Math.abs(toMidi(b) - midi))[0];
        const staffIdx =
          staves < 2 ? 0 : exact ? staffOf(exact) : nearest ? staffOf(nearest) : clefForMidi(midi, staves) === 'bass' ? 1 : 0;
        const gm = osmd.GraphicSheet.MeasureList[step.measure - 1]?.[staffIdx] as unknown as OsmdMeasure | undefined;
        const topUnits = gm?.ParentStaffLine?.PositionAndShape.AbsolutePosition.y;
        if (topUnits === undefined) return null;
        const measureClef = gm?.InitiallyActiveClef?.ClefType === 1 ? 'bass' : 'treble';

        const onStaff = candidates.filter((n) => staffOf(n) === staffIdx);
        // Under an 8va the heads sit an octave below the pitch: place the mark there too.
        const shift = shiftOf(osmd, exact ?? onStaff[0] ?? stepNotes[0]);
        const headOf = (n: OsmdNote) => {
          const g = osmd.EngravingRules.GNote(n as never) as unknown as OsmdGraphicalNote | undefined;
          const el = g?.getSVGGElement?.();
          return el?.querySelector('.vf-notehead') ?? el ?? null;
        };
        // A held tie (#10136) sits on its own head; a struck note on the step's head.
        const head = headOf(anchor ?? stepNotes.find((n) => staffOf(n) === staffIdx) ?? stepNotes[0]);
        if (!head) return null;

        const layerRect = layer.getBoundingClientRect();
        const svgRect = svg.getBoundingClientRect();
        const headRect = head.getBoundingClientRect();
        const space = 10 * osmd.Zoom; // OSMD: 1 unit = one staff space = 10px at zoom 1

        const written = onStaff
          .map((n) => {
            const w = writtenOf(n);
            return w && drawnNote(w, shiftOf(osmd, n));
          })
          .filter((w): w is WrittenNote => w !== null);
        const spelled = spellPlayed(midi - shift, fifths, written);
        const steps = staffOffsetSteps(spelled, measureClef);
        const y = svgRect.top - layerRect.top + (topUnits + steps / 2) * space;
        const ledgers: number[] = [];
        for (let k = steps % 2 === 0 ? steps : steps - 1; k >= 10; k -= 2) ledgers.push(((k - steps) / 2) * space);
        for (let k = steps % 2 === 0 ? steps : steps + 1; k <= -2; k += 2) ledgers.push(((k - steps) / 2) * space);

        return {
          id: ++markIdRef.current,
          x: headRect.left + headRect.width / 2 - layerRect.left,
          y,
          space,
          ledgers,
          // A correct note never gets a red accidental, only a wrong one.
          accidental: wrong ? accidentalMark(spelled, fifths, written) : null,
          wrong,
          midi,
        };
      } catch (err) {
        // The overlay is visual only; never break following over it, but say so.
        console.warn('[overlay] could not place played note', midi, err);
        return null;
      }
    },
    [fifths],
  );

  // #10136: as the cursor moves from `from` to `to`, a tied note he is still sounding
  // (key down or pedal) turns blue like a struck one. One he let go of stays black.
  // #5568: so does one he strikes again (`struck`), at the step he is on or the one he
  // just left: the loop's first step is checked as the cursor lands, before he plays it.
  const paintHeldTies = useCallback(
    (from: number, to: number, struck?: number) => {
      const ties = tieNotesRef.current;
      const osmd = osmdRef.current;
      const sounding = struck === undefined ? soundingNow() : new Set([struck]);
      // A held note under an 8va (#10146) rings as the pitch he holds where it is drawn.
      const pitchesOf = (n: OsmdNote) => {
        const shift = osmd ? shiftOf(osmd, n) : 0;
        return shift && sounding.has(toMidi(n) - shift) ? toMidi(n) - shift : toMidi(n);
      };
      const picks = heldTies(ties.map((t) => t.map(pitchesOf)), from, to, sounding);
      const added = picks.flatMap(({ step, index }): PlayedMark[] => {
        const mark = placePlayed(step, toMidi(ties[step][index]), false, ties[step][index]);
        return mark ? [{ ...mark, tie: `${step}:${index}` }] : [];
      });
      // A tie already painted (held, then struck again) is not drawn twice.
      if (added.length) setMarks((m) => [...m, ...added.filter((a) => !m.some((k) => k.tie === a.tie))]);
    },
    [placePlayed],
  );

  // Strip (#5153): slide the music so the cursor sits in the middle of the panel.
  const centerCursor = useCallback((behavior: ScrollBehavior) => {
    const panel = panelRef.current;
    const el = osmdRef.current?.cursor.cursorElement;
    if (!stripRef.current || !panel || !el) return;
    const c = el.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    const left = panel.scrollLeft + (c.left + c.width / 2) - (p.left + panel.clientLeft + panel.clientWidth * STRIP_ANCHOR);
    panel.scrollTo({ left: Math.max(0, left), behavior }); // at the start the clef, key and 'Piano' stay on screen
  }, []);

  // #6369: bring the cursor into sight by scrolling only the box that holds the score, and only when
  // it is out of sight (or under the sticky toolbar). scrollIntoView moved every scroller up the tree,
  // so the range boxes jumped under his pointer each time a range landed.
  const revealCursor = useCallback(() => {
    const el = osmdRef.current?.cursor.cursorElement;
    let box: HTMLElement | null = el?.parentElement ?? null;
    while (box && !(box.scrollHeight > box.clientHeight && /auto|scroll/.test(getComputedStyle(box).overflowY))) {
      box = box.parentElement;
    }
    if (!el || !box) return;
    const c = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const toolbar = box.querySelector('[data-score-toolbar]')?.getBoundingClientRect();
    const top = Math.max(b.top, toolbar ? toolbar.bottom : b.top);
    if (c.top >= top && c.bottom <= b.bottom) return;
    box.scrollTop += c.top + c.height / 2 - (top + b.bottom) / 2;
  }, []);

  // #6373: Pages shows one spread (two pages) at a time. The other pages keep their place in the
  // grid, only hidden, so every overlay drawn over them stays where it was; a turn scrolls the
  // spread's row up under the toolbar. OSMD's own follow is off here: the spread follows instead.
  const spreadRef = useRef(0);
  const [spreadView, setSpreadView] = useState<{ at: number; pages: number; top: number; height: number } | null>(null);
  const showSpread = useCallback((want: number, scroll: boolean) => {
    const container = containerRef.current;
    if (!container) return;
    const pages = [...container.children].filter((el): el is HTMLElement => /^osmdCanvasPage\d+$/.test(el.id));
    if (pages.length === 0) return;
    const at = Math.max(0, Math.min(Math.ceil(pages.length / 2) - 1, want));
    spreadRef.current = at;
    pages.forEach((p, k) => { p.style.visibility = Math.floor(k / 2) === at ? '' : 'hidden'; });
    const first = pages[at * 2];
    setSpreadView({ at, pages: pages.length, top: first.offsetTop, height: first.offsetHeight });
    if (!scroll) return;
    let box: HTMLElement | null = container.parentElement;
    while (box && !(box.scrollHeight > box.clientHeight && /auto|scroll/.test(getComputedStyle(box).overflowY))) {
      box = box.parentElement;
    }
    if (!box) return;
    const b = box.getBoundingClientRect();
    const toolbar = box.querySelector('[data-score-toolbar]')?.getBoundingClientRect();
    const top = Math.max(b.top, toolbar ? toolbar.bottom : b.top);
    // Room above the pages for the "Pages 3-4 of 7" bar.
    box.scrollTop += first.getBoundingClientRect().top - SPREAD_BAR_PX - top;
  }, []);
  const turnSpread = useCallback((way: number) => showSpread(spreadRef.current + way, true), [showSpread]);
  // The spread the cursor is on: OSMD moves its cursor into that page's div.
  const cursorSpread = useCallback(() => {
    const id = osmdRef.current?.cursor.cursorElement?.parentElement?.id ?? '';
    const page = Number(/^osmdCanvasPage(\d+)$/.exec(id)?.[1] ?? 0);
    return page ? Math.floor((page - 1) / 2) : null;
  }, []);
  // #6585: the spread a bar is drawn on (null before the pages exist).
  const spreadOfBar = useCallback((bar: number) => {
    const osmd = osmdRef.current;
    const container = containerRef.current;
    if (!osmd || !container || bar < 1) return null;
    const page = Number(/^osmdCanvasPage(\d+)$/.exec(pageSvgOf(osmd, container, bar - 1)?.parentElement?.id ?? '')?.[1] ?? 0);
    return page ? Math.floor((page - 1) / 2) : null;
  }, []);

  // Move the visible cursor to step index i (relative moves; OSMD has no seek).
  const moveCursorTo = useCallback((i: number) => {
    const osmd = osmdRef.current;
    if (!osmd) return;
    while (cursorIndexRef.current < i && !osmd.cursor.iterator.EndReached) {
      osmd.cursor.next();
      cursorIndexRef.current++;
    }
    while (cursorIndexRef.current > i && cursorIndexRef.current > 0) {
      osmd.cursor.previous();
      cursorIndexRef.current--;
    }
    setCursorStep(cursorIndexRef.current);
    centerCursor('smooth');
  }, [centerCursor]);

  // Light the chord symbol once the keys struck under it (plus any still sounding)
  // hold all its notes: broken chords and arpeggios count. Passing chord=null
  // just turns the current one off.
  const trackChord = useCallback((chord: StepChord | null, notes: number[], bar?: number) => {
    const osmd = osmdRef.current;
    let cur = chordLitRef.current;
    if (cur.chord !== chord) {
      if (osmd && cur.chord && cur.lit) paintChord(osmd, cur.chord.container, false);
      cur = chordLitRef.current = { chord, played: new Set(), lit: false };
    }
    if (!chord || !osmd) return;
    notes.forEach((n) => cur.played.add(n));
    if (!cur.lit && playsChord(chord, cur.played)) {
      cur.lit = true;
      paintChord(osmd, chord.container, true);
      reportEvent('chord_match', { symbol: chord.label, bar });
    }
  }, []);

  const reportExpression = useCallback((found: ExpressionFinding[]) => {
    if (!found.length) return;
    for (const x of found) {
      reportEvent('expression', {
        type: x.kind, expected: x.expected, played: x.played, ok: x.ok, text: x.text,
        bar: x.mark.bar, endBar: x.mark.endBar, source: x.mark.source, confidence: x.mark.confidence,
        detail: x.detail,
      });
    }
    setExprFindings((prev) => [...prev, ...found.map((x) => x.text)].slice(-30));
  }, []);

  const syncUi = useCallback(() => {
    const f = followerRef.current;
    if (!f) return;
    const left = f.expected.filter((m) => !f.satisfied.has(m));
    setRemaining(left);
    setStepKeys(f.expected);
    setPlayHint(hintFor(osmdRef.current, stepNotesRef.current[f.index] ?? [], left));
    // Parked past the end of a loop (#5382 target reached): stay on the loop's last bar. Only
    // parked: wheeled past the loop (#5560), he's in the bar he's in.
    const step = f.steps[Math.min(f.index, (f.finished ? f.range?.last : undefined) ?? f.steps.length - 1)];
    setMeasure(step?.measure ?? 1);
    setPace(f.paceBpm);
    // Any move off the parked spot (a step button, a new loop) means he's playing again.
    if (!f.finished) setReached(null);
  }, []);

  const restart = useCallback(() => {
    if (keepRef.current) {
      window.clearInterval(keepRef.current.timer);
      if (keepRef.current.rolandOn) void rolandSend({ on: 0 });
      keepRef.current = null;
      setKeep(null);
      setClimb(null);
      reportEvent('keep', { on: false });
    }
    watchRunRef.current++;
    window.clearTimeout(watchTimerRef.current);
    setWatching(false);
    setWatchNotes([]);
    const bpm = watchBpmRef.current;
    watchBpmRef.current = null;
    if (bpm !== null) {
      releaseChords();
      reportEvent('watch', { on: false, bpm });
    }
    const osmd = osmdRef.current;
    const f = followerRef.current;
    if (!osmd || !f) return;
    setMarks([]);
    trackChord(null, []);
    osmd.cursor.reset();
    osmd.cursor.show();
    cursorIndexRef.current = 0;
    f.reset();
    moveCursorTo(f.index);
    // The step walk at load leaves the view scrolled to the end; bring bar 1 back.
    if (stripRef.current) centerCursor('auto');
    else if (layoutRef.current === 'pages') showSpread(cursorSpread() ?? 0, true);
    else revealCursor();
    setLooking(false);
    setFeedback({ kind: 'idle' });
    setReached(null);
    // #5657c: Restart while blocking goes back to the first hand position.
    const b = blockRef.current;
    if (b) setBlock(startBlocking(b.positions, useMidiStore.getState().held, b.need));
    setWrongCount(0);
    useMidiStore.getState().setPaused(false); // #5948
    setLap(f.lap);
    lapStartRef.current = null;
    lastAdvanceRef.current = null;
    window.clearTimeout(hesitateTimerRef.current);
    setHesitating(false);
    lapWrongRef.current = 0;
    lapWrongBarsRef.current = new Set();
    lapSkippedRef.current = false;
    exprRef.current?.reset();
    exprNewPassRef.current = false;
    setExprFindings([]);
    syncUi();
  }, [moveCursorTo, centerCursor, revealCursor, showSpread, cursorSpread, syncUi, trackChord]);

  // #6122: Restart pressed by hand starts a rep (restart() itself also runs internally).
  const restartByHand = useCallback(() => {
    restart();
    emitRep('start');
  }, [restart]);

  const buildFollower = useCallback((osmd: OpenSheetMusicDisplay) => {
    const { steps, notes, ringing, ties, chords, restBefore, rests } = extractSteps(osmd, handRef.current, holdsOf(drawnXml));
    stepRestRef.current = restBefore;
    pedalCoachRef.current.reset();
    stepNotesRef.current = notes;
    stepRestsRef.current = rests;
    ringNotesRef.current = ringing;
    tieNotesRef.current = ties;
    stepChordsRef.current = chords;
    trackChord(null, []);
    chordLitRef.current = noChord();
    followerRef.current = new ScoreFollower(steps);
    const exprMarksParsed = parseExpression(drawnXml);
    exprRef.current = new ExpressionTracker(exprMarksParsed, steps);
    setExprMarks(exprMarksParsed.map(describeMark));
    setStepsVersion((v) => v + 1);
    return { steps, exprMarksParsed };
  }, [drawnXml, trackChord]);

  const toggleWatch = async () => {
    if (watching) {
      restart();
      return;
    }
    const f = followerRef.current;
    if (!f?.steps.length || status !== 'ready') return;
    const run = ++watchRunRef.current;
    try {
      await initAudio();
    } catch (err) {
      console.warn('[watch] audio initialization failed:', err);
      return;
    }
    // Audio may finish opening after he leaves this piece or restarts.
    if (run !== watchRunRef.current || followerRef.current !== f) return;
    const range = f.range;
    const first = range?.first ?? cursorIndexRef.current;
    const last = range?.last ?? f.steps.length - 1;
    if (!f.steps[first]) return;
    const bpm = piece.targetBpm ?? 80;
    watchBpmRef.current = bpm;
    setWatching(true);
    reportEvent('watch', { on: true, bpm });

    const playStep = (i: number) => {
      if (run !== watchRunRef.current) return;
      const step = f.steps[i];
      const nextBeat = i < last ? f.steps[i + 1].beat : step.beat + 1;
      const durationSeconds = (nextBeat - step.beat) * 60 / bpm;
      moveCursorTo(i);
      setMeasure(step.measure);
      setWatchNotes(step.notes);
      // #6425: tied chords and held notes sound their full written length.
      const byEnd = new Map<number, number[]>();
      for (const [midi, end] of soundUntil(f.steps, i, last, f.steps[last].beat + 1)) {
        byEnd.set(end, [...(byEnd.get(end) ?? []), midi]);
      }
      for (const [end, group] of byEnd) playChord(group, (end - step.beat) * 60 / bpm);
      watchTimerRef.current = window.setTimeout(() => {
        if (i < last) playStep(i + 1);
        else if (range) playStep(first);
        else restart();
      }, durationSeconds * 1000);
    };
    playStep(first);
  };

  useEffect(() => {
    setWatching(false);
    setWatchNotes([]);
    return () => {
      // Invalidate an audio start still waiting for the browser, too.
      watchRunRef.current++;
      window.clearTimeout(watchTimerRef.current);
      const bpm = watchBpmRef.current;
      watchBpmRef.current = null;
      if (bpm !== null) {
        releaseChords();
        reportEvent('watch', { on: false, bpm });
      }
    };
  }, [piece.id, drawnXml]);

  // --- Keep going (#5652 K) ---
  useEffect(() => {
    setKeepBpm(useSettingsStore.getState().keepBpms[pieceLabelRef.current] ?? 60);
    setKeepLast(null);
    return () => {
      if (keepRef.current) window.clearInterval(keepRef.current.timer);
      if (keepRef.current?.rolandOn) void rolandSend({ on: 0 });
      keepRef.current = null;
      setKeep(null);
      setClimb(null);
    };
  }, [piece.id, drawnXml]);

  // #6530 D/E: a waiting banner shows once he pauses (no note for 4 s) and Keep going isn't running.
  useEffect(() => {
    pendingAdviceRef.current = null;
    lessonRef.current = null;
    setLesson(null);
    lapsSinceAdviceRef.current = 0;
    keepLapsSinceAdviceRef.current = 0;
    setAdvice(null);
    let seen = useMidiStore.getState().lastNoteOn;
    let lastAt = Date.now();
    const id = window.setInterval(() => {
      const now = Date.now();
      const ev = useMidiStore.getState().lastNoteOn;
      if (ev !== seen) {
        seen = ev;
        lastAt = now;
      }
      const p = pendingAdviceRef.current;
      // Not over Keep going, Play it for me, Block, Key first or Pause.
      if (!p || keepRef.current || keepStartingRef.current || watchBpmRef.current !== null || blockRef.current ||
        keyGateRef.current || useMidiStore.getState().pausedAt !== null || now - lastAt < ADVICE_PAUSE_MS) return;
      pendingAdviceRef.current = null;
      const st = useSettingsStore.getState();
      // Stale: another piece, another loop since, or found over 2 minutes ago.
      if (p.piece !== pieceNameRef.current || p.loop !== loopKeyOf() || now - p.at > ADVICE_STALE_MS || !st.adviceOn || !mayOffer(p.card.rule, now, localDay(), lastAdviceAt(), st.adviceQuiet)) return;
      adviceShownAtRef.current = now;
      setAdvice(p.card);
      reportEvent('advice', { ...p.card.data, rule: p.card.rule, text: p.card.text, shown: true });
    }, 500);
    return () => window.clearInterval(id);
  }, [piece.id]);

  const toggleKeep = async () => {
    if (keepRef.current) {
      restart();
      return;
    }
    // One start at a time: a second click while audio or the Roland is still answering does nothing.
    if (keepStartingRef.current) return;
    stopLesson('keep'); // #6530 F: Keep going runs on his own loop
    keepStartingRef.current = true;
    try {
      await beginKeep();
    } finally {
      keepStartingRef.current = false;
    }
  };
  // slowerBpm (#6530 D [Play it slower]): this tempo, no climb, the click on whatever the setting says.
  const beginKeep = async (slowerBpm?: number) => {
    const f = followerRef.current;
    // [Play it slower] has just stopped any watch; this render's `watching` can still say true.
    if (!f?.steps.length || status !== 'ready' || (watching && slowerBpm === undefined) || blockRef.current || keyGateRef.current) return;
    try {
      await initAudio();
    } catch (err) {
      console.warn('[keep] audio initialization failed:', err);
      return;
    }
    if (followerRef.current !== f || keepRef.current) return;
    const steps = f.steps;
    // His loop, lap after lap; with no loop, the whole piece once from the top.
    const looping = !!f.range;
    const first = f.range?.first ?? 0;
    const last = f.range?.last ?? steps.length - 1;
    const startPrefs = useSettingsStore.getState();
    // #6530 C: a climb starts from his last Keep going tempo (or 70% of the target) and aims for the target.
    // The same piece and bars carry on the climb they had (a whole-piece run ends after one pass).
    const climbKey = `${pieceLabelRef.current}#${first}-${last}`;
    const carry = climbCarryRef.current;
    const climbing = !startPrefs.climbOn || slowerBpm !== undefined ? null
      : carry && carry.key === climbKey && carry.climb.target === clampBpm(climbTarget) ? carry.climb
      : startClimb(climbTarget, startPrefs.keepBpms[pieceLabelRef.current] ?? null);
    const bpm = climbing ? climbing.bpm : clampBpm(slowerBpm ?? keepBpm);
    const count = countInBeats(steps, first);
    // The Roland's own click (opt-in): its tempo now, switched on at the first beat after the count-in.
    // No Roland found = the app's click.
    const roland = startPrefs.rolandClick && await rolandSend({ tempo: bpm });
    if (followerRef.current !== f || keepRef.current || useMidiStore.getState().pausedAt !== null) return;
    const run = startKeep(first, last, bpm, Date.now() + count * beatMs(bpm));
    keepRef.current = { run, timer: 0, beat: Number.NEGATIVE_INFINITY, step: -2, climb: climbing, roland, rolandOn: false, climbKey, click: slowerBpm !== undefined };
    setClimb(climbing);
    setKeepLast(startPrefs.rolandClick && !roland ? "Couldn't reach the Roland's metronome: the app is clicking." : null);
    if (climbing) reportEvent('climb', { on: true, target: climbing.target, start: climbing.start, reaction: startPrefs.climbReaction, roland });
    setKeep({ bpm, lap: 1, count, hit: 0, wrong: 0 });
    moveCursorTo(first);
    setMeasure(steps[first].measure);
    setMarks([]);
    emitRep('start'); // #6122: the count-in is about to run
    reportEvent('keep', { on: true, bpm, startMs: run.startMs, firstBar: steps[first].measure, lastBar: steps[last].measure, looping });

    const tick = () => {
      const k = keepRef.current;
      if (!k || followerRef.current !== f) return;
      const t = Date.now();
      const r = k.run;
      const prefs = useSettingsStore.getState();
      if (t >= lapEndMs(r, steps)) {
        const lap = closeLap(r, steps, prefs.keepStepUp && !k.climb, piece.targetBpm);
        emitRep('end'); // #6122
        if (k.climb) {
          // #6530 C: the climb, not the +4 rule, sets the next lap's tempo.
          const sec = (lapBeats(steps, r.first, r.last) * beatMs(lap.bpm)) / 1000;
          const { climb: next, change } = climbLap(k.climb, lap, sec, prefs.climbReaction);
          k.climb = next;
          climbCarryRef.current = { key: k.climbKey, climb: next };
          r.bpm = next.bpm;
          lap.nextBpm = next.bpm;
          setClimb(next);
          setKeepLast(`${lapLabel({ ...lap, nextBpm: lap.bpm })} ${climbLabel(next, change)}`);
          reportEvent('climb', { change, bpm: next.bpm, target: next.target, lap: lap.lap, missed: lap.missed, wrong: lap.wrong });
          if (change === 'reached') {
            // #5521's glow wave three times and the chime.
            if (prefs.celebrateChime) void playLapChime();
            startWave(r.first, r.last, 0.7, 3);
            reportEvent('celebrate', { what: 'climb', target: next.target });
          }
        } else setKeepLast(lapLabel(lap));
        if (k.roland && lap.nextBpm !== lap.bpm) void rolandSend({ tempo: lap.nextBpm });
        reportEvent('keep', { ...lap });
        // #6530 D: a Keep going lap (not a climb: the climb sets its own tempo) counts toward speed vs misses.
        if (!k.climb && ++keepLapsSinceAdviceRef.current >= 3) {
          keepLapsSinceAdviceRef.current = 0;
          checkAdviceRef.current({ first: steps[r.first].measure, last: steps[r.last].measure }, 'keep');
        }
        if (lap.nextBpm !== lap.bpm) {
          setKeepBpm(lap.nextBpm);
          prefs.setKeepBpm(pieceLabelRef.current, lap.nextBpm);
        }
        if (!looping) {
          restart();
          return;
        }
        k.beat = Number.NEGATIVE_INFINITY;
        setKeep((s) => s && { ...s, bpm: r.bpm, lap: r.lap, hit: 0, wrong: 0 });
      }
      // The click on every beat of the count-in and the lap, the bar's first beat higher.
      const beat = Math.floor((t - r.startMs) / beatMs(r.bpm));
      if (beat !== k.beat) {
        k.beat = beat;
        if (k.roland && !k.rolandOn && beat >= 0) {
          k.rolandOn = true;
          void rolandSend({ on: 1 });
        }
        const down = beat < 0 ? beat === -count : beat % count === 0;
        // With the Roland clicking, the app only counts in (its beat can't be lined up with ours).
        if ((prefs.keepClick || k.click) && !(k.roland && beat >= 0)) playNote(down ? 96 : 91, '32n');
        setKeep((s) => s && { ...s, count: beat < 0 ? -beat : 0 });
      }
      const i = stepAt(r, steps, t);
      if (i >= 0 && i !== k.step) {
        k.step = i;
        moveCursorTo(i);
        setMeasure(steps[i].measure);
      }
    };
    keepRef.current.timer = window.setInterval(tick, 10);
  };

  // --- loop range (#5004) ---
  // keepChunk: Build backwards moving its own loop. Any other loop change ends it.
  const applyLoop = useCallback(
    (bars: { first: number; last: number } | null, keepChunk = false) => {
      const f = followerRef.current;
      if (!f) return;
      if (!keepChunk) {
        setChunk(null);
        setBlock(null);
        if (lessonRef.current) {
          reportEvent('lesson', { on: false, why: 'loop' });
          lessonRef.current = null;
          setLesson(null);
        }
      }
      if (bars) {
        const first = Math.min(bars.first, bars.last);
        const last = Math.max(bars.first, bars.last);
        const range = stepRangeOf(f.steps, first, last);
        if (!range) return;
        f.setRange(range.first, range.last);
        setLoopBars({ first, last });
        // Build backwards moving its own loop isn't him choosing a range (#5259).
        if (!keepChunk) useSettingsStore.getState().setPieceLoop(pieceLabelRef.current, { first, last });
        // #6460: a range he chose: bars inside it he keeps missing join his trouble spots.
        if (!keepChunk) checkSpotsRef.current({ first, last });
        reportEvent('loop', { firstBar: first, lastBar: last });
      } else {
        f.clearRange();
        setLoopBars(null);
        reportEvent('loop', { cleared: true });
      }
      setPicking('off');
      setPickStart(null);
      setLapBpm(null);
      restart();
    },
    [restart, setBlock],
  );

  const chunkEvent = (c: ChunkState, extra: Record<string, unknown> = {}) =>
    reportEvent('chunk', {
      firstBar: c.first, lastBar: c.last, startBar: c.start, endBar: loopEnd(c), ...(c.out ? { outward: true } : {}),
      clean: c.clean, need: c.need, done: c.done, ...extra,
    });

  // Build backwards on his loop: start on its last bar. Off again: back to the whole loop.
  const startBackwards = (bars: { first: number; last: number }) => {
    endLesson('backwards'); // #6530 F: not alongside a lesson plan
    const c = startChunk(bars.first, bars.last, parseTargets(useSettingsStore.getState().backwardTargets));
    setChunk(c);
    applyLoop({ first: c.start, last: c.last }, true);
    useSettingsStore.getState().setPieceLoop(pieceLabelRef.current, { first: c.first, last: c.last });
    chunkEvent(c, { on: true });
  };
  const toggleBackwards = () => {
    if (chunk) {
      chunkEvent(chunk, { on: false });
      applyLoop({ first: chunk.first, last: chunk.last });
    } else if (loopBars) startBackwards(lessonRef.current?.main ?? loopBars);
  };
  // #6371 Build outward: his loop is the core; it grows a bar each side toward the smallest
  // starred span around it (else the whole piece).
  const wholePiece = () => {
    const steps = followerRef.current?.steps;
    return steps?.length ? { first: steps[0].measure, last: steps[steps.length - 1].measure } : null;
  };
  const beginOutward = (core: { first: number; last: number }) => {
    const whole = wholePiece();
    if (!whole) return;
    endLesson('outward'); // #6530 F: not alongside a lesson plan
    const stars = starsOf(useSettingsStore.getState().pieceStars, pieceLabelRef.current);
    const c = startOutward(core, outerFor(core, stars, whole), parseTargets(useSettingsStore.getState().backwardTargets));
    setBlock(null); // the tutor API can start it while Block is on; the toolbar can't
    setChunk(c);
    applyLoop({ first: c.start, last: loopEnd(c) }, true);
    useSettingsStore.getState().setPieceLoop(pieceLabelRef.current, { first: c.first, last: c.last });
    chunkEvent(c, { on: true });
  };
  // #6460 trouble spots. The 3 s line under the toolbar for added / ticked-off spots.
  const showSpotTip = (text: string) => {
    setSpotTip((prev) => (prev ? `${prev} · ${text}` : text)); // a tick-off and an add in one lap both show
    window.clearTimeout(spotTipTimerRef.current);
    spotTipTimerRef.current = window.setTimeout(() => setSpotTip(''), 3000);
  };
  const spanText = (sp: { first: number; last: number }) => (sp.first === sp.last ? `bar ${sp.first}` : `bars ${sp.first}–${sp.last}`);
  const putSpot = (span: { first: number; last: number }) => {
    const st = useSettingsStore.getState();
    const title = pieceLabelRef.current;
    st.setSpots(title, addSpot(prune(own(st.troubleSpots, title), localDay()), span, localDay()));
    showSpotTip(`Added: ${spanText(span)}`);
    reportEvent('spot', { added: [span], manual: true });
  };
  const addSpotAt = (bar: number) => {
    const whole = wholePiece();
    if (whole) putSpot(spotAround(bar, whole));
  };
  // One lap or whole-piece pass ended: count it for each spot (alone / in context), tick off finished ones.
  spotPassRef.current = () => {
    const f = followerRef.current;
    const wrongBars = lapWrongBarsRef.current;
    const skipped = lapSkippedRef.current;
    lapWrongBarsRef.current = new Set();
    lapSkippedRef.current = false;
    // #6530 F: a lesson plan's laps leave his trouble-spot list alone (Jarvis 13356).
    if (!f || skipped || !f.steps.length || lessonRef.current) return;
    const r = f.range;
    const lapBars = r ? { first: f.steps[r.first].measure, last: f.steps[r.last].measure } : wholePiece();
    if (!lapBars) return;
    const st = useSettingsStore.getState();
    const title = pieceLabelRef.current;
    const before = own(st.troubleSpots, title);
    if (before.length) {
      const { spots, ticked } = countPass(before, lapBars, wrongBars, st.spotClean, localDay());
      st.setSpots(title, spots);
      reportEvent('spot', {
        pass: lapBars, wrongBars: [...wrongBars],
        ...(ticked.length ? { ticked: ticked.map((t) => ({ first: t.first, last: t.last })) } : {}),
      });
      if (ticked.length) {
        for (const t of ticked) st.dismissSpot(title, t, true);
        const names = ticked.map((t) => spanText(t)).join(', ');
        showSpotTip(`${names.charAt(0).toUpperCase()}${names.slice(1)} off your list!`);
        void playChime();
      }
    }
    // A whole-piece pass checks the whole piece every time (#6513); a loop, every 5 laps of it.
    if (!r || ++lapsSinceSpotCheckRef.current >= 5) checkSpotsRef.current(lapBars);
  };
  // Bars in this range his log says he keeps missing or hesitating on (last 7 days) join the list.
  checkSpotsRef.current = (range) => {
    lapsSinceSpotCheckRef.current = 0;
    const call = (window as unknown as { tutorBridge?: { practiceRollup?: (days: number) => Promise<Rollup | null> } }).tutorBridge?.practiceRollup;
    const whole = wholePiece();
    if (!call || !whole) return;
    const title = pieceLabelRef.current;
    const name = pieceName;
    void call(7).then((roll) => {
      if (pieceLabelRef.current !== title) return;
      const bars = roll?.pieces.find((p) => p.piece === name)?.spotBars ?? [];
      const st = useSettingsStore.getState();
      const recent = (bar: number, since: number) => (missLogRef.current.get(`${title}#${bar}`) ?? []).filter((t) => t >= since).length;
      const current = prune(own(st.troubleSpots, title), localDay());
      // A whole-piece check (#6513) tops the open list up to AUTO_OPEN_CAP; a loop he set adds as before.
      const isWhole = range.first <= whole.first && range.last >= whole.last;
      const open = current.filter((s) => !s.ticked).length;
      const { spots, added, merged } = autoSpots(
        current, own(st.spotDismissed, title), bars, range, whole, Date.now(), localDay(), recent,
        isWhole ? Math.min(AUTO_MAX_PER_CHECK, AUTO_OPEN_CAP - open) : AUTO_MAX_PER_CHECK,
      );
      if (!added.length && !merged.length) return;
      st.setSpots(title, spots);
      // #6530: overlapping spots he hadn't started on became one 3-5 bar loop; logged so he can undo it.
      if (merged.length) st.logMerges(title, merged);
      const said = [
        ...(added.length ? [`Added: ${added.map(spanText).join(', ')}`] : []),
        ...merged.map((m) => `Joined ${m.from.length} spots into ${spanText(m.to)}`),
      ];
      showSpotTip(said.join(' · '));
      reportEvent('spot', {
        added, auto: true,
        ...(merged.length ? { merged: merged.map((m) => ({ from: m.from.map(({ first, last }) => ({ first, last })), to: m.to })) } : {}),
      });
    }, (err: unknown) => console.warn('[spots] rollup failed:', err));
  };
  // #6530 D/E: after a lap or a pass, the first rule with something to say (7-day roll-up + this loop's
  // own laps). A finding waits in pendingAdviceRef for a pause (below), never shown mid-lap (Karen 13318).
  checkAdviceRef.current = (bars, kind) => {
    const st = useSettingsStore.getState();
    if (!st.adviceOn || pendingAdviceRef.current || !gapOpen(Date.now(), lastAdviceAt())) return;
    const call = (window as unknown as { tutorBridge?: { practiceRollup?: (days: number) => Promise<Rollup | null> } }).tutorBridge?.practiceRollup;
    const name = pieceName;
    const title = pieceLabelRef.current;
    const loop = loopKeyOf();
    const steps = followerRef.current?.steps ?? [];
    // This loop's data as it stands now (the next lap adds to it while the roll-up loads).
    const d = adviceData();
    const laps = d.laps.map((l) => [...l]);
    const entries = new Map([...d.entries].filter(([bar]) => bar > bars.first && bar <= bars.last).map(([bar, l]) => [bar, [...l]]));
    const vel = [...d.vel];
    // #6530 E: the pass just played, as it stands before spotPass clears it (a skipped pass isn't judged).
    const live: Run | null = kind === 'pass' && !lapSkippedRef.current
      ? { first: bars.first, last: bars.last, wrong: lapWrongRef.current, wrongBars: [...lapWrongBarsRef.current], at: Date.now() }
      : null;
    const midnight = new Date().setHours(0, 0, 0, 0);
    const missesToday = new Map<number, number>();
    for (const [key, times] of missLogRef.current) {
      if (!key.startsWith(`${title}#`)) continue;
      const n = times.filter((t) => t >= midnight).length;
      if (n) missesToday.set(Number(key.slice(title.length + 1)), n);
    }
    const find = (roll: Rollup | null): AdviceCard | null => {
      const day = localDay();
      const quiet = useSettingsStore.getState().adviceQuiet;
      const ok = (r: AdviceRule) => quiet[r] !== day;
      const p = roll?.pieces.find((x) => x.piece === name);
      const speed = () => {
        const sp = p && ok('speed') ? speedVsMisses(p.runs, bars) : null;
        return sp && p ? speedCard(sp, slowBars(p.spotBars.filter((b) => b.bar >= sp.first && b.bar <= sp.last))) : null;
      };
      if (kind === 'keep') return speed();
      const back = () => {
        if (!ok('spotBack')) return null;
        const mine = own(useSettingsStore.getState().troubleSpots, title);
        const active = mine.filter((sp) => !sp.ticked);
        // A ticked spot that a live one covers again is already back on his list.
        const near = mine.filter((sp) => sp.last >= bars.first && sp.first <= bars.last &&
          !(sp.ticked && active.some((o) => o.last >= sp.first && o.first <= sp.last)));
        const r = spotBack(near, missesToday, day);
        return r ? spotBackCard(r.spot, r.daysAgo, r.misses) : null;
      };
      const reshape = () => {
        const r = kind === 'lap' && ok('reshape') ? loopReshape(laps, bars) : null;
        return r ? reshapeCard(r.clean, r.windows) : null;
      };
      const pause = () => {
        const r = ok('pause') ? pauseBefore(entries) : null;
        return r ? pauseCard(r.bar, r.times, bars.first) : null;
      };
      const quieter = () => {
        const r = ok('velocity') ? velocityOutlier(vel) : null;
        const bar = r ? steps[r.step]?.measure : undefined;
        return r && bar !== undefined ? velocityCard(noteName(r.note), bar, r.ratio, r.laps, r.hand) : null;
      };
      const worse = () => {
        if (!p || !live || !ok('worse')) return null;
        // Earlier runs of the same bars; the one just logged (this pass) is left out.
        const others: Run[] = p.runs
          .filter((x) => x.kind !== 'keep' && x.firstBar === bars.first && x.lastBar === bars.last && x.at < live.at - 10_000)
          .map((x) => ({ first: x.firstBar, last: x.lastBar, wrong: x.wrong, wrongBars: x.wrongBars ?? [], at: x.at }));
        const r = worseThanBest(live, others);
        return r ? worseCard(r.now, r.best, r.windows) : null;
      };
      return kind === 'lap'
        ? speed() ?? back() ?? reshape() ?? pause() ?? quieter()
        : speed() ?? worse() ?? back() ?? pause() ?? quieter();
    };
    const offer = (roll: Rollup | null) => {
      if (pieceNameRef.current !== name || pendingAdviceRef.current) return;
      const card = find(roll);
      if (card) pendingAdviceRef.current = { card, piece: name, loop, at: Date.now() };
    };
    if (!call) {
      offer(null);
      return;
    }
    // A moment for the log to take the run just reported.
    window.setTimeout(() => {
      void call(7).then(offer, (err: unknown) => {
        console.warn('[advice] rollup failed:', err);
        offer(null);
      });
    }, 300);
  };
  const playSlower = async (tryBpm: number) => {
    // The whole piece, from the top, at his clean tempo, with the click. restart() also stops a watch.
    if (followerRef.current?.range) applyLoop(null);
    else restart();
    const bpm = clampBpm(tryBpm);
    setKeepBpm(bpm);
    useSettingsStore.getState().setKeepBpm(pieceLabelRef.current, bpm);
    if (keepStartingRef.current) return;
    keepStartingRef.current = true;
    try {
      await beginKeep(bpm);
    } finally {
      keepStartingRef.current = false;
    }
  };
  const actOnAdvice = () => {
    const a = advice;
    const act = a?.action;
    if (!a || !act) return;
    setAdvice(null);
    reportEvent('advice', {
      rule: a.rule, action: act.kind,
      ...(act.kind === 'slower' ? { tryBpm: act.bpm } : act.kind === 'loop' ? { span: act.span } : { windows: act.windows }),
    });
    if (act.kind === 'slower') void playSlower(act.bpm);
    else if (act.kind === 'loop') applyLoop(act.span);
    else if (act.windows.length) {
      // #6530 E loop reshape: the new loops go on his trouble-spot list; the first one starts now.
      const st = useSettingsStore.getState();
      const title = pieceLabelRef.current;
      const day = localDay();
      st.setSpots(title, act.windows.reduce((list, w) => addSpot(list, w, day, true), prune(own(st.troubleSpots, title), day)));
      reportEvent('spot', { added: act.windows, auto: true, reshape: true });
      applyLoop(act.windows[0]);
      showSpotTip(`Added: ${act.windows.map(spanText).join(', ')}`);
    }
  };
  const closeAdvice = (action: 'not-today' | 'close') => {
    const rule = advice?.rule ?? 'speed';
    if (action === 'not-today') useSettingsStore.getState().quietAdvice(rule, localDay());
    setAdvice(null);
    reportEvent('advice', { rule, action });
  };
  // #6530 F: build the plan from this loop's last laps (button only, after LESSON_MIN_LAPS laps).
  const flashTip = (text: string) => {
    setGrewTip(text);
    window.clearTimeout(grewTipTimerRef.current);
    grewTipTimerRef.current = window.setTimeout(() => setGrewTip(''), 3000);
  };
  const startLesson = () => {
    const loop = loopBars;
    if (!loop || chunkRef.current || blockRef.current || keepRef.current) return;
    const plan = buildPlan(adviceData().laps, loop);
    if (!plan) {
      flashTip('This loop is clean.');
      reportEvent('lesson', { on: false, why: 'clean' });
      return;
    }
    const first = plan.steps[0];
    putLesson(plan);
    reportEvent('lesson', { on: true, main: plan.main, steps: plan.steps });
    applyLoop({ first: first.first, last: first.last }, true);
  };
  // Stop: back to his own loop, exactly as it was (his saved loop and spot list never changed).
  const stopLesson = (why: string) => {
    const plan = lessonRef.current;
    if (!plan) return;
    putLesson(null);
    reportEvent('lesson', { on: false, why, at: plan.at });
    applyLoop(plan.main, true);
  };
  const skipLesson = () => {
    const plan = lessonRef.current;
    if (!plan) return;
    const { state, done } = skipStep(plan);
    if (done) {
      stopLesson('skipped-last');
      return;
    }
    putLesson(state);
    const step = state.steps[state.at];
    reportEvent('lesson', { at: state.at, skipped: true, firstBar: step.first, lastBar: step.last });
    applyLoop({ first: step.first, last: step.last }, true);
    flashTip(nextLabel(state));
  };
  const toggleOutward = () => {
    if (chunk) {
      chunkEvent(chunk, { on: false });
      applyLoop({ first: chunk.first, last: chunk.last });
    } else if (loopBars) beginOutward(lessonRef.current?.main ?? loopBars);
  };

  // #5657c: the loop's notes grouped into hand positions; `at` resumes after a fingering reload.
  // The follower's steps in bars first..last, each note with its hand and written finger.
  const blockSteps = useCallback((first: number, last: number): BlockStep[] => {
    const steps: BlockStep[] = [];
    followerRef.current?.steps.forEach((s, i) => {
      if (s.measure < first || s.measure > last) return;
      const notes = (stepNotesRef.current[i] ?? []).filter((n) => !n.IsGraceNote).map((n) => ({
        midi: toMidi(n),
        hand: staffOf(n) === 0 ? ('R' as const) : ('L' as const),
        finger: n.Fingering?.value?.trim() || undefined,
      }));
      steps.push({ step: i, bar: s.measure, notes });
    });
    return steps;
  }, []);
  const startBlock = useCallback((bars: { first: number; last: number }, at = 0) => {
    if (!followerRef.current) return;
    const positions = groupPositions(blockSteps(bars.first, bars.last));
    if (!positions.length) return;
    const held = useMidiStore.getState().held;
    const i = Math.min(at, positions.length - 1);
    setBlock({ ...startBlocking(positions, held), at: i, armed: !positions[i].keys.some((k) => held.has(k)) });
    moveCursorTo(positions[i].firstStep);
    reportEvent('block', { on: true, firstBar: bars.first, lastBar: bars.last, positions: positions.length, at: i });
  }, [moveCursorTo, setBlock, blockSteps]);

  // A step's first head for one hand: its x, and the top line of its staff, px in the layer.
  const makePlacer = useCallback(() => {
    const osmd = osmdRef.current!;
    const container = containerRef.current!;
    const f = followerRef.current!;
    const layerRect = layerRef.current!.getBoundingClientRect();
    const space = 10 * osmd.Zoom;
    const placeOf = (step: number, h: 'L' | 'R') => {
      const bar = f.steps[step]?.measure;
      const note = (stepNotesRef.current[step] ?? []).find((n) => !n.IsGraceNote && (staffOf(n) === 0 ? 'R' : 'L') === h);
      if (bar === undefined || !note) return null;
      const svg = pageSvgOf(osmd, container, bar - 1);
      const gm = osmd.GraphicSheet.MeasureList[bar - 1]?.[staffOf(note)] as unknown as OsmdMeasure | undefined;
      const top = gm?.ParentStaffLine?.PositionAndShape.AbsolutePosition.y;
      const g = osmd.EngravingRules.GNote(note as never) as unknown as OsmdGraphicalNote | undefined;
      const el = g?.getSVGGElement?.();
      const head = el?.querySelector('.vf-notehead') ?? el;
      if (!svg || top === undefined || !head) return null;
      const r = head.getBoundingClientRect();
      return { x: r.left + r.width / 2 - layerRect.left, top: svg.getBoundingClientRect().top - layerRect.top + top * space };
    };
    return { placeOf, space };
  }, []);

  // #6086: shade the notes of the position he is on (both hands), so "this position" is visible.
  const blockCur = block && !block.done ? block.positions[block.at] : null;
  useEffect(() => {
    if (!blockCur || !osmdRef.current || !containerRef.current || !layerRef.current || !followerRef.current || status !== 'ready' || view !== 'score') {
      setBlockBands(null);
      return;
    }
    try {
      const { placeOf, space } = makePlacer();
      const steps: number[] = [];
      for (let i = blockCur.firstStep; i <= blockCur.lastStep; i++) steps.push(i);
      const hands = new Set(blockCur.fingers.map((n) => n.hand));
      setBlockBands([...hands].flatMap((h) => bandsOf(placeOf, space, steps, h, 0)));
    } catch (err) {
      console.warn('[block] could not shade the position', err);
      setBlockBands(null);
    }
  }, [blockCur, status, layoutTick, stepsVersion, view, zoneTick, makePlacer]);

  // #11354 item 4 (JP homework 11/6: "see which fingers are moving where and how to set things
  // down so that you can reach the most notes possible without fishing"): each hand's positions
  // shaded on its staff, and a mark where a hand jumps 5+ keys with no rest before it.
  useEffect(() => {
    const osmd = osmdRef.current;
    const container = containerRef.current;
    const layer = layerRef.current;
    const f = followerRef.current;
    // The photo view hides the score: nothing to measure until it's back.
    if (!zonesOn || !osmd || !container || !layer || !f || status !== 'ready' || view !== 'score') {
      setZones(null);
      return;
    }
    try {
      const handOf = (n: OsmdNote) => (staffOf(n) === 0 ? 'R' : 'L');
      const { placeOf, space } = makePlacer();
      const steps = blockSteps(1, Number.MAX_SAFE_INTEGER);
      const bands: ZoneBand[] = [];
      const marks: ZoneMark[] = [];
      const shifts: Shift[] = [];
      const count = { R: 0, L: 0 };
      for (const h of ['R', 'L'] as const) {
        const zs = handZones(steps, h);
        count[h] = zs.length;
        for (const z of zs) {
          bands.push(...bandsOf(placeOf, space, z.steps, h, z.index));
        }
        const rests = new Set<number>();
        stepRestsRef.current.forEach((rs, i) => {
          if (rs?.some((r) => handOf(r) === h)) rests.add(i);
        });
        for (const sh of fishingShifts(zs, rests)) {
          shifts.push(sh);
          const pl = placeOf(sh.step, h);
          if (!pl) continue;
          marks.push({
            x: pl.x - space * 1.2,
            y: h === 'R' ? pl.top - space * 1.8 : pl.top + space * 5.8,
            size: space * 0.7,
            title: `${h === 'R' ? 'Right' : 'Left'} hand jumps ${sh.semitones} keys here (bar ${sh.bar}) with no rest before it: plan where it lands`,
          });
        }
      }
      setZones({ bands, marks, right: count.R, left: count.L, shifts });
    } catch (err) {
      console.warn('[zones] could not draw hand zones', err);
      setZones(null);
    }
  }, [zonesOn, status, layoutTick, stepsVersion, blockSteps, view, zoneTick]);

  // #11354 item 6 (JP 10/23, Sorcerer's Apprentice: "Who's moving where? Who stays the same? Is
  // there a bigger pattern across multiple chords?").
  useEffect(() => {
    const osmd = osmdRef.current;
    const layer = layerRef.current;
    if (!chordsOn || !osmd || !layer || status !== 'ready' || view !== 'score') {
      setChords(null);
      return;
    }
    try {
      const layerRect = layer.getBoundingClientRect();
      const space = 10 * osmd.Zoom;
      const headAt = (step: number, h: 'L' | 'R', midi: number) => {
        const note = (stepNotesRef.current[step] ?? []).find(
          (n) => !n.IsGraceNote && (staffOf(n) === 0 ? 'R' : 'L') === h && toMidi(n) === midi,
        );
        const r = note && headOf(osmd.EngravingRules.GNote(note as never) as unknown as OsmdGraphicalNote | undefined)?.getBoundingClientRect();
        return r ? { x: r.left + r.width / 2 - layerRect.left, y: r.top + r.height / 2 - layerRect.top } : null;
      };
      const steps = blockSteps(1, Number.MAX_SAFE_INTEGER);
      const rings: ChordRing[] = [];
      const tags: ChordTag[] = [];
      let changes = 0;
      let kept = 0;
      let same = 0;
      let shifts = 0;
      for (const h of ['R', 'L'] as const) {
        const handName = h === 'R' ? 'Right' : 'Left';
        for (const c of chordChanges(steps, h)) {
          changes++;
          if (c.voices.some((v) => v.kind === 'stay')) kept++;
          if (c.same) same++;
          if (c.shift !== null) shifts++;
          let top: { x: number; y: number } | null = null;
          for (const v of c.voices) {
            const at = headAt(c.step, h, v.midi);
            if (!at) continue;
            if (!top || at.y < top.y) top = at;
            rings.push({
              x: at.x,
              y: at.y,
              r: space * 0.75,
              kind: v.kind,
              label: v.kind === 'move' ? movedBy(v.by) : '',
              title: v.kind === 'stay'
                ? `${handName} hand: ${noteName(v.midi)} stays (bar ${c.bar})`
                : v.kind === 'move'
                  ? `${handName} hand: moves ${Math.abs(v.by)} key${Math.abs(v.by) === 1 ? '' : 's'} ${v.by > 0 ? 'up' : 'down'} to ${noteName(v.midi)} (bar ${c.bar})`
                  : `${handName} hand: ${noteName(v.midi)} is added (bar ${c.bar})`,
            });
          }
          const text = c.shift !== null ? `all ${movedBy(c.shift)}` : c.same ? 'same move' : '';
          if (text && top) tags.push({ x: top.x, y: top.y - space * 2.2, text });
        }
      }
      setChords({ rings, tags, changes, kept, same, shifts });
    } catch (err) {
      console.warn('[chords] could not draw chord moves', err);
      setChords(null);
    }
  }, [chordsOn, status, layoutTick, stepsVersion, blockSteps, view, zoneTick, noteName]);
  const startBlockRef = useRef(startBlock);
  startBlockRef.current = startBlock;
  const toggleBlock = () => {
    const b = blockRef.current;
    if (b) {
      reportEvent('block', { on: false, at: b.at, done: b.done });
      setBlock(null);
      restart();
    } else if (lessonRef.current) {
      const main = lessonRef.current.main;
      stopLesson('block'); // #6530 F: Block runs on his own loop
      startBlock(main);
    } else if (loopBars) startBlock(loopBars);
  };

  // #10236: he typed a new overall range. The cursor only jumps if the loop itself changed.
  const editRange = (next: { first: number; last: number }) => {
    const f = followerRef.current;
    if (!f || next.first > next.last || !stepRangeOf(f.steps, next.first, next.last)) return;
    const c = chunkRef.current;
    if (!c) {
      applyLoop(next);
      return;
    }
    const targets = parseTargets(useSettingsStore.getState().backwardTargets);
    const edited = c.out ? outwardRangeEdited(c, next.first, next.last, targets) : rangeEdited(c, next.first, next.last, targets);
    setChunk(edited);
    useSettingsStore.getState().setPieceLoop(pieceLabelRef.current, next);
    if (edited.start !== c.start || loopEnd(edited) !== loopEnd(c)) applyLoop({ first: edited.start, last: loopEnd(edited) }, true);
    // #5382: an earlier first bar un-finishes it; a parked follower has to loop again.
    else if (reached && !edited.done) restart();
    chunkEvent(edited, { edited: true });
  };

  // Typed instead of clicked: the same two steps as clicking the first bar and the last.
  const typedFirst = (bar: number) => {
    if (picking === 'off') {
      if (overall) editRange({ first: bar, last: overall.last });
    } else if (followerRef.current?.steps.some((st) => st.measure === bar)) {
      setPickStart(bar);
      setPicking('end');
    }
  };
  const typedLast = (bar: number) => {
    if (picking !== 'off') {
      if (pickStart !== null) applyLoop({ first: pickStart, last: bar });
    } else if (overall) editRange({ first: overall.first, last: bar });
  };

  // #5521: glow the noteheads of steps first..last, one beat after another, `times` over.
  const startWave = useCallback((first: number, last: number, peak: number, times = 1) => {
    const osmd = osmdRef.current;
    const layer = layerRef.current;
    const steps = followerRef.current?.steps;
    if (!osmd || !layer || !steps) return;
    const layerRect = layer.getBoundingClientRect();
    const found: { x: number; y: number; r: number; beat: number }[] = [];
    for (let i = first; i <= last; i++) {
      for (const n of stepNotesRef.current[i] ?? []) {
        const head = headOf(osmd.EngravingRules.GNote(n as never) as unknown as OsmdGraphicalNote | undefined);
        const rect = head?.getBoundingClientRect();
        if (!rect || !rect.width) continue;
        found.push({
          x: rect.left + rect.width / 2 - layerRect.left,
          y: rect.top + rect.height / 2 - layerRect.top,
          r: Math.max(rect.width, rect.height) * 0.9,
          beat: steps[i].beat,
        });
      }
    }
    const delays = waveDelays(found.map((d) => d.beat));
    const dots = found.map(({ x, y, r }, i) => ({ x, y, r, delayMs: delays[i] }));
    if (!dots.length) return;
    const span = Math.max(0, ...delays) + WAVE_FLARE_MS;
    waveTimersRef.current.forEach((t) => window.clearTimeout(t));
    waveTimersRef.current = [];
    for (let n = 0; n < times; n++) {
      waveTimersRef.current.push(window.setTimeout(() => setWave({ key: Date.now(), dots, peak }), n * (span + 150)));
    }
    waveTimersRef.current.push(window.setTimeout(() => setWave(null), times * (span + 150)));
  }, []);
  useEffect(() => () => waveTimersRef.current.forEach((t) => window.clearTimeout(t)), []);

  // #5521: a clean lap (no wrong note or stray in it) gets a ding and/or the glow wave.
  const celebrateLap = useCallback((range: { first: number; last: number } | null) => {
    const prefs = useSettingsStore.getState();
    if (prefs.celebrateChime) void playLapChime();
    if (prefs.celebrateWave && range) startWave(range.first, range.last, 0.45);
    reportEvent('celebrate', { what: 'lap', chime: prefs.celebrateChime, wave: prefs.celebrateWave && !!range });
  }, [startWave]);

  // One lap wrapped. Clean (no wrong note in it) counts toward the chunk; enough of
  // them and the loop starts a bar earlier. A wrong lap just doesn't count.
  // Returns true when the note that wrapped it shouldn't be judged (grew or stopped).
  const chunkLap = useCallback(() => {
    emitRep('end'); // #6122: a rep (one lap) is done
    spotPassRef.current();
    const wrong = lapWrongRef.current;
    lapWrongRef.current = 0;
    const c = chunkRef.current;
    const lapRange = followerRef.current?.range ?? null;
    const plan = lessonRef.current;
    if (!c && plan) {
      // #6530 F: a clean lap counts toward this step; a wrong lap just doesn't count.
      const { state, advanced, done } = lessonLapDone(plan, wrong);
      reportEvent('lesson', {
        at: state.at, clean: state.clean, need: state.steps[state.at].need, wrongInLap: wrong,
        ...(advanced ? { advanced: true, firstBar: state.steps[state.at].first, lastBar: state.steps[state.at].last } : {}),
        ...(done ? { done: true } : {}),
      });
      if (done) {
        lessonRef.current = null;
        setLesson(null);
        applyLoop(state.main, true);
        const r = followerRef.current?.range;
        const prefs = useSettingsStore.getState();
        if (prefs.celebrateChime) void playLapChime();
        if (r) startWave(r.first, r.last, 0.7, 3);
        reportEvent('celebrate', { what: 'lesson', steps: state.steps.length });
        // Parked past the end like a Build backwards finale (#5382): Go again loops his loop again.
        const f = followerRef.current;
        if (f) f.seek(f.steps.length);
        setReached('Lesson plan complete.');
        syncUi();
        return true;
      }
      lessonRef.current = state;
      setLesson(state);
      if (advanced) {
        const step = state.steps[state.at];
        applyLoop({ first: step.first, last: step.last }, true);
        setGrewTip(nextLabel(state));
        window.clearTimeout(grewTipTimerRef.current);
        grewTipTimerRef.current = window.setTimeout(() => setGrewTip(''), 3000);
        return true;
      }
      if (wrong === 0) celebrateLap(lapRange);
      return false;
    }
    if (!c) {
      if (wrong === 0) celebrateLap(lapRange);
      return false;
    }
    const targets = parseTargets(useSettingsStore.getState().backwardTargets);
    const { state, grew, reached: hit } = c.out ? outwardLapDone(c, wrong, targets) : lapDone(c, wrong, targets);
    chunkRef.current = state;
    setChunk(state);
    chunkEvent(state, { grew, wrongInLap: wrong, ...(hit ? { reached: true } : {}) });
    if (grew) {
      applyLoop({ first: state.start, last: loopEnd(state) }, true);
      setGrewTip(state.out ? outwardGrewLabel(state) : grewLabel(state));
      window.clearTimeout(grewTipTimerRef.current);
      grewTipTimerRef.current = window.setTimeout(() => setGrewTip(''), 3000);
    }
    if (hit) {
      // #5382: done. Park the follower past the end so more notes don't count; Restart
      // (the banner's button or the toolbar's) loops the whole range again.
      const f = followerRef.current;
      if (f) f.seek(f.steps.length);
      // #5521: a finale scaled to what he built: a few bars, a flourish; 16+, a hooray.
      const bars = state.last - state.first + 1;
      const size = bars <= 4 ? 'small' : bars <= 15 ? 'medium' : 'big';
      const prefs = useSettingsStore.getState();
      setReached((size === 'big' && prefs.celebrateFinale ? 'Hooray! ' : '') + reachedLabel(state));
      reportEvent('celebrate', { what: 'finale', size, bars, finale: prefs.celebrateFinale });
      if (prefs.celebrateFinale) {
        void playFanfare(size);
        if (lapRange) startWave(lapRange.first, lapRange.last, size === 'small' ? 0.55 : 0.7, size === 'big' ? 2 : 1);
      } else {
        void playChime();
      }
      syncUi();
    } else if (wrong === 0) {
      celebrateLap(lapRange);
    }
    return grew || hit;
  }, [applyLoop, syncUi, celebrateLap, startWave]);

  // Bar under a click on the score, from OSMD's bar layout.
  const barAt = (clientX: number, clientY: number): number | null => {
    const osmd = osmdRef.current;
    const container = containerRef.current;
    if (!osmd || !container) return null;
    for (const [bar, b] of barBoxes(osmd)) {
      const svg = pageSvgOf(osmd, container, bar - 1);
      if (!svg) continue;
      const r = svg.getBoundingClientRect();
      const x = clientX - r.left;
      const y = clientY - r.top;
      if (x >= b.x && x <= b.x + b.w && y >= b.y - 10 && y <= b.y + b.h + 10) return bar;
    }
    return null;
  };

  const onScoreClick = (e: React.MouseEvent) => {
    if (picking === 'off' || status !== 'ready') return;
    const bar = barAt(e.clientX, e.clientY);
    if (bar === null) return;
    if (picking === 'start') {
      setPickStart(bar);
      setPicking('end');
    } else {
      applyLoop({ first: pickStart ?? bar, last: bar });
    }
  };

  // Shade the loop (or the start bar while picking). Recomputed after any re-layout.
  useEffect(() => {
    const osmd = osmdRef.current;
    const container = containerRef.current;
    const layer = layerRef.current;
    const range = previewBars ?? loopBars ?? (pickStart !== null ? { first: pickStart, last: pickStart } : null);
    if (!osmd || !container || !layer || !range || status !== 'ready') {
      setBands([]);
      return;
    }
    try {
      const layerRect = layer.getBoundingClientRect();
      const out: Band[] = [];
      for (const [bar, b] of barBoxes(osmd)) {
        if (bar < range.first || bar > range.last) continue;
        const svg = pageSvgOf(osmd, container, bar - 1);
        if (!svg) continue;
        const svgRect = svg.getBoundingClientRect();
        const dx = svgRect.left - layerRect.left;
        const dy = svgRect.top - layerRect.top;
        out.push({ ...b, x: b.x + dx, y: b.y + dy });
      }
      setBands(out);
    } catch (err) {
      console.warn('[loop] could not shade bars', err);
      setBands([]);
    }
  }, [previewBars, loopBars, pickStart, status, layoutTick]);
  // #6531: coming from the Strip, the pages are measured before they have settled into place, so
  // the loop shading landed off the spread. Measure the overlays again once the new layout is drawn.
  useEffect(() => {
    if (status !== 'ready') return;
    const timer = window.setTimeout(() => setLayoutTick((t) => t + 1), 300);
    return () => window.clearTimeout(timer);
  }, [scoreLayout, status]);

  // A loop asked for through the tutor API (POST /loop, DELETE /loop). Used up once it applies:
  // left in the store, it came back on every piece that finished loading (#10262).
  const ready = status === 'ready';
  useEffect(() => {
    if (!loopRequest || !ready) return;
    useTutorStore.getState().clearLoopRequest();
    if ('clear' in loopRequest) applyLoop(null);
    else if (loopRequest.backwards) startBackwards({ first: loopRequest.firstBar, last: loopRequest.lastBar });
    else if (loopRequest.outward) beginOutward({ first: loopRequest.firstBar, last: loopRequest.lastBar });
    else applyLoop({ first: loopRequest.firstBar, last: loopRequest.lastBar });
  }, [loopRequest?.seq, ready]);

  useEffect(() => {
    if (!pendingOpen || drawnPieceRef.current !== pendingOpen.pieceId || pendingOpen.pieceId !== piece.id) return;
    setPendingOpen(null);
    const range = useSettingsStore.getState().pieceLoops[piece.label];
    if (!range || !followerRef.current || !stepRangeOf(followerRef.current.steps, range.first, range.last)) {
      setPickStart(null);
      setPicking('start');
    } else if (pendingOpen.backwards) startBackwards(range);
    else applyLoop(range);
  }, [pendingOpen, piece.id, drawn]);

  // live = for a re-layout of this screen (#6531), where a lesson plan carries on: its sub-loop.
  // Otherwise (relaunch, parked drill) the plan doesn't come back, so his own loop (#6530 F).
  const takeSnapshot = (on: Piece, live = false): SessionSnapshot => ({
    at: Date.now(),
    pieceId: rememberRef(on.id, on.label, !!on.xml).id,
    pieceLabel: on.label,
    loop: live ? loopBars : (lessonRef.current?.main ?? loopBars),
    chunk,
    lap: live || !lessonRef.current ? lap : 0,
    wrongCount,
    lapWrong: lapWrongRef.current,
    step: cursorStep,
    hand,
    following,
    showOriginal,
  });
  // #6531: where he is right now, for a re-layout (P / Strip-Pages-Scroll / bar numbers) of the
  // same score to put back: loop, place, lap, drill. Read by the load effect before it resets.
  liveSnapRef.current = status === 'ready' && onScreen && drawnPieceRef.current === piece.id
    ? { ...takeSnapshot(onScreen, true), pieceId: piece.id }
    : null;

  // #10236: keep the snapshot current. Not while loading, when these describe the piece before.
  useEffect(() => {
    const save = window.tutorBridge?.sessionSave;
    if (!save || status !== 'ready' || !onScreen || drawnPieceRef.current !== piece.id) return;
    const timer = window.setTimeout(() => save(takeSnapshot(onScreen)), 500);
    return () => window.clearTimeout(timer);
  }, [status, piece.id, loopBars, chunk, lap, wrongCount, cursorStep, hand, following, showOriginal, drawn]);

  // #10262 Sight-read: a piece he doesn't know, one hand, 5-8 bars, through the ordinary hand and
  // loop controls. Reads the library and never writes a score. What he was drilling is parked first.
  const simplePieces = useSettingsStore((s) => s.simplePieces);
  const toggleSimple = useSettingsStore((s) => s.toggleSimplePiece);
  const parkedDrills = useSettingsStore((s) => s.parkedDrills);
  const [pendingSight, setPendingSight] = useState<string | null>(null);
  const [sightMsg, setSightMsg] = useState('');
  const sightRead = () => {
    commitWheelRef.current();
    const s = useSettingsStore.getState();
    if (onScreen && status === 'ready' && drawnPieceRef.current === piece.id && piece.id !== s.sightReadPiece) {
      s.parkDrill(takeSnapshot(onScreen));
    }
    const skip = new Set([piece.label, ...Object.values(useSettingsStore.getState().parkedDrills).map((d) => d.pieceLabel)]);
    const pick = pickSightPiece(
      allPieces
        // A song's first version is its easiest; the built-ins aren't his library.
        .filter((p) => p.id.startsWith('file:') && !skip.has(p.label) && (!p.group || p.id === versionsOf(p.group.slug)[0].id))
        .map((p) => ({
          id: p.id,
          label: p.label,
          xml: p.xml,
          simple: s.simplePieces.includes(p.label),
          favorite: s.favoritePieces.includes(p.label),
          drilled: s.sightDrilled[p.label] ?? 0,
          trusted: p.trust?.status !== 'issues',
        })),
    );
    if (!pick) {
      setSightMsg('No other piece to read.');
      return;
    }
    s.markSightRead(pick.id, pick.label);
    const nextHand = pickHand(pick.xml);
    handRef.current = nextHand;
    setHand(nextHand);
    setPendingSight(pick.id);
    setSightMsg('');
    setPieceId(pick.id);
  };
  // #11354 Fresh tune (JP, lesson 11/6: easy pieces "will help too"; Todd: ones he has never heard).
  // A short folk melody from the bundled corpus, in the key he is drilling, never the same one twice.
  // Hints start off; a wrong note brings them back. Its run is logged as a fresh-tune event.
  const freshKey = useSettingsStore((s) => s.freshKey);
  const freshTune = () => {
    commitWheelRef.current();
    const s = useSettingsStore.getState();
    if (onScreen && status === 'ready' && drawnPieceRef.current === piece.id && !freshRef.current) {
      s.parkDrill(takeSnapshot(onScreen));
    }
    const k = FRESH_KEYS.find((x) => x.name === s.freshKey) ?? FRESH_KEYS[0];
    const pick = pickFreshTune(freshTunesJson as FreshTune[], k.mode, new Set(s.freshSeen));
    if (!pick) {
      setSightMsg(`No fresh ${k.mode} tune left: try a ${k.mode === 'minor' ? 'major' : 'minor'} key.`);
      return;
    }
    s.markFreshSeen(pick.id);
    const label = `Fresh tune ${s.freshSeen.length + 1} (${keyTitle(k.name)})`;
    freshRef.current = { id: pick.id, key: k.name, label };
    handRef.current = 'both';
    setHand('both');
    setSightMsg('');
    useTutorStore.getState().addPiece({ label, xml: freshTuneXml(pick, k.name, label) });
    reportEvent('fresh-tune', { id: pick.id, key: k.name, label });
  };
  // #11354 item 3 (JP doc 11/6; lesson 11/6, "I will embrace it"): end a session with five
  // minutes on this piece without training wheels. Counts the bars he clears and his misses;
  // a bar he is still in when it stops doesn't count.
  const startBareRun = () => {
    const r = startBare(piece.id, Date.now());
    bareRef.current = r;
    setBare(r);
    setBareLeft(r.endsAt - Date.now());
    setBareMsg('');
    reportEvent('bare-start', { label: piece.label });
  };
  const finishBare = useCallback((early: boolean) => {
    const r = bareRef.current;
    if (!r) return;
    const done = r;
    bareRef.current = null;
    setBare(null);
    const label = pieceLabelRef.current;
    reportEvent('bare-done', { label, cleared: done.cleared, misses: done.misses, early, ms: Date.now() - (r.endsAt - BARE_MS) });
    setBareMsg(`${early ? 'Stopped' : 'Five minutes without hints'}: ${done.cleared} bar${done.cleared === 1 ? '' : 's'} clean, ${done.misses} miss${done.misses === 1 ? '' : 'es'}.`);
  }, []);
  useEffect(() => {
    if (!bare) return;
    const t = window.setInterval(() => {
      const left = bare.endsAt - Date.now();
      setBareLeft(Math.max(0, left));
      if (left <= 0) finishBare(false);
    }, 1000);
    return () => window.clearInterval(t);
    // Only a new run restarts the clock, not each bar it counts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bare?.endsAt, finishBare]);
  // Leaving the piece ends the run.
  useEffect(() => {
    if (bareRef.current && bareRef.current.pieceId !== piece.id) finishBare(true);
  }, [piece.id, finishBare]);

  // The drill to go back to: the one he left most recently.
  const backTo = Object.values(parkedDrills)
    .sort((a, b) => b.at - a.at)
    .map((d) => allPieces.find((p) => p.id === d.pieceId) ?? allPieces.find((p) => p.label === d.pieceLabel))[0];

  // #6369: done looking. The next note he plays (right or wrong) slides the strip back to his place.
  const endLook = useCallback(() => {
    if (!lookingRef.current) return false;
    setLooking(false);
    centerCursor('smooth');
    return true;
  }, [centerCursor]);
  useEffect(
    () => useMidiStore.subscribe((state, prev) => {
      if (state.lastNoteOn && state.lastNoteOn !== prev.lastNoteOn) endLook();
    }),
    [endLook],
  );

  // Esc clears the loop (or cancels picking). Looking away, it only brings him back (#6369).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (endLook()) return;
      if (picking !== 'off') {
        setPicking('off');
        setPickStart(null);
      } else if (loopBars) applyLoop(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picking, loopBars, applyLoop, endLook]);

  // #6373: P flips to Pages and back to the layout he came from (a trackball button can send P).
  // In Pages, Page Up / Page Down and the mouse's back / forward buttons turn a spread.
  // Never while he types: a P in a bar box or any text field is just a letter.
  useEffect(() => {
    const typing = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || typing(e.target) || typing(document.activeElement)) return;
      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        togglePages();
      } else if (scoreLayout === 'pages' && (e.key === 'PageDown' || e.key === 'PageUp')) {
        e.preventDefault();
        turnSpread(e.key === 'PageDown' ? 1 : -1);
      }
    };
    const onButton = (e: MouseEvent) => {
      if (scoreLayout !== 'pages' || (e.button !== 3 && e.button !== 4)) return;
      e.preventDefault();
      turnSpread(e.button === 4 ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mouseup', onButton);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mouseup', onButton);
    };
  }, [scoreLayout, togglePages, turnSpread]);
  // #6585: opening Two pages with a loop selected lands on the spread holding the loop's first bar
  // (the breaks are fixed; a loop longer than two pages simply opens at its start).
  const pagesOpenedRef = useRef(false);
  const holdSpreadAtStepRef = useRef<number | null>(null);
  useEffect(() => {
    if (scoreLayout !== 'pages') {
      pagesOpenedRef.current = false;
      return;
    }
    if (status !== 'ready' || pagesOpenedRef.current) return;
    const at = loopBars ? spreadOfBar(loopBars.first) : null;
    // No page divs yet (the layout change is still redrawing): try again when it is ready.
    if (loopBars && at === null) return;
    pagesOpenedRef.current = true;
    if (at === null) return;
    // The cursor may sit on another spread: leave him on the loop's until the cursor actually moves.
    holdSpreadAtStepRef.current = cursorStep;
    showSpread(at, true);
  }, [scoreLayout, status, drawn, loopBars, cursorStep, spreadOfBar, showSpread]); // drawn: each redraw (layout change) re-checks
  // Playing on past the spread turns it: he is never left on an old one.
  useEffect(() => {
    if (scoreLayout !== 'pages' || status !== 'ready') return;
    if (holdSpreadAtStepRef.current === cursorStep) return; // opened on his loop (#6585)
    holdSpreadAtStepRef.current = null;
    const at = cursorSpread();
    if (at !== null && at !== spreadRef.current) showSpread(at, true);
  }, [cursorStep, scoreLayout, status, showSpread, cursorSpread]);

  // Keep the latest hand for loading without reloading OSMD on a hand switch.
  useEffect(() => {
    handRef.current = hand;
    if (status !== 'ready' || !osmdRef.current) return;
    // Steps keep their cursor positions, so a loop he set still covers the same bars.
    const range = followerRef.current?.range ?? null;
    buildFollower(osmdRef.current);
    if (range) followerRef.current?.setRange(range.first, range.last);
    restart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hand]);

  // --- load + render the selected piece ---
  useEffect(() => {
    // The photo view is the default when there is no score to show.
    setView(piece.xml ? 'score' : 'photo');
  }, [piece.id, drawnXml]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    setStaffCount(0);
    // #10160: don't flash the default piece while his last one is still being found.
    if (!startResolved) {
      setStatus('loading');
      return;
    }
    // #6531: the same score drawn again in another layout keeps where he was (it cleared his loop).
    // Only when the last score drawn is this same piece with this same xml (a re-read file is not a re-layout).
    const live = liveSnapRef.current;
    const loaded = loadedRef.current;
    // ...and only when the layout itself changed: the same piece pushed again starts fresh, as before.
    const layoutKey = `${scoreLayout}/${everyBarNumbers}`;
    relayoutSnapRef.current = live && loaded && loaded.pieceId === piece.id && loaded.xml === drawnXml &&
      loaded.layout !== layoutKey && live.pieceId === piece.id && resumeStepRef.current === null ? live : null;
    // #10262: off the sight-read piece. Back on a parked piece the drill returns (before the load:
    // the hand decides the steps); anywhere else the hand Sight-read chose doesn't follow him.
    const settings = useSettingsStore.getState();
    const leftSight = settings.sightReadPiece !== null && settings.sightReadPiece !== piece.id;
    if (leftSight) {
      settings.clearSightRead();
      setSightMsg('');
    }
    const parkedId = rememberRef(piece.id, piece.label, !!piece.xml).id;
    const parked = settings.parkedDrills[parkedId];
    if (parked) settings.unparkDrill(parkedId);
    const back = parked && resumeStepRef.current === null && !restoreRef.current ? restorable(parked, true, Date.now()) : null;
    if (back) {
      restoreRef.current = { ...back, pieceId: piece.id };
      handRef.current = back.hand;
      setHand(back.hand);
      setFollowing(back.following);
      setShowOriginal(back.showOriginal);
    } else if (leftSight && !restoreRef.current) {
      handRef.current = 'both';
      setHand('both');
    }
    if (!piece.xml) {
      setStatus('photo');
      return;
    }
    let disposed = false;
    setStatus('loading');
    spreadRef.current = 0;
    setSpreadView(null);

    const osmd = new OpenSheetMusicDisplay(container, {
      autoResize: true,
      autoBeam: true,
      backend: 'svg',
      drawTitle: !strip && scoreLayout !== 'pages', // Two pages: music only, the title is in the piece list (#6585)
      followCursor: scoreLayout === 'scroll', // #6373: Pages follows a spread at a time instead
      // Break lines where the printed page does (#5056), so the bar number at the start
      // of each line matches the boxed number on his page.
      newSystemFromXML: !strip,
      ...(scoreLayout === 'pages' ? { pageFormat: 'A4_P', pageBackgroundColor: '#FFFFFF' } : {}),
      // #5657: he's used to every bar numbered, so Pages and Scroll do that unless he turns it off.
      ...(!strip && everyBarNumbers ? { measureNumberInterval: 1 } : {}),
      // Strip (#5153): the whole piece on one line, slid by centerCursor, so there are no
      // line starts to carry bar numbers: number every bar. The title is in the piece list.
      ...(strip ? {
        renderSingleHorizontalStaffline: true,
        measureNumberInterval: 1,
      } : {}),
      ...(strip || scoreLayout === 'pages' ? {
        drawSubtitle: false,
        drawComposer: false,
        drawLyricist: false,
        drawCredits: false,
      } : {}),
    });
    const render = osmd.render.bind(osmd);
    // autoResize calls this.render(), so the instance override covers re-layouts too.
    osmd.render = () => {
      orderChordFingers(osmd);
      if (scoreLayout === 'pages') fitPages(osmd, container);
      render();
      if (strip && fitStrip(osmd, container, panelRef.current)) render();
      paintFingerings(osmd, container);
      liftStrip(osmd, layerRef.current, strip ? panelRef.current : null); // no panel: lift cleared
      centerCursor('auto'); // a re-layout moves the cursor along the strip
      if (scoreLayout === 'pages') showSpread(spreadRef.current, true); // new page divs: hide again
    };
    osmdRef.current = osmd;
    const cursorObs = keepCursorHeight(container);

    osmd
      .load(dropChordRests(latestXmlRef.current))
      .then(() => {
        if (disposed) return;
        osmd.render();
        osmd.cursor.show();
        setStaffCount(osmd.Sheet.Staves.length);
        const { steps, exprMarksParsed } = buildFollower(osmd);
        setLoopBars(null);
        setPicking('off');
        setPickStart(null);
        restart();
        // After his fingering edit re-renders the score, put him back where he was.
        // A relaunch or parked-drill restore wins; a re-layout snapshot is used only for its own piece.
        const relaySnap = relayoutSnapRef.current?.pieceId === piece.id ? relayoutSnapRef.current : null;
        relayoutSnapRef.current = null;
        loadedRef.current = { pieceId: piece.id, xml: drawnXml, layout: `${scoreLayout}/${everyBarNumbers}` };
        const snap = restoreRef.current?.pieceId === piece.id ? restoreRef.current : (relaySnap ?? restoreRef.current);
        restoreRef.current = null;
        const relayout = snap !== null && snap === relaySnap;
        const restored = resumeStepRef.current === null && snap?.pieceId === piece.id ? snap : null;
        const resume = restored ? restored.step : resumeStepRef.current;
        const resumeLoop = restored ? restored.loop : resumeLoopRef.current;
        resumeStepRef.current = null;
        resumeLoopRef.current = null;
        // A real piece switch ends Build backwards; a fingering/hold reload keeps it with the loop.
        if (resume === null || !resumeLoop) {
          setChunk(null);
          endLesson('reload'); // #6530 F: its loop is gone
        }
        // #5657c: blocking too; a reload rebuilds its positions (fingers decide them) where he was.
        const blockAt = resume !== null && resumeLoop ? (blockRef.current?.at ?? null) : null;
        blockRef.current = null;
        setBlockState(null);
        if (resume !== null && followerRef.current) {
          // Keep his loop too (#10134): Restart then still goes to the loop's first bar.
          const range = resumeLoop && stepRangeOf(followerRef.current.steps, resumeLoop.first, resumeLoop.last);
          if (range) {
            followerRef.current.setRange(range.first, range.last);
            setLoopBars(resumeLoop);
          }
          if (restored) {
            // After restart(), which zeroes these. A loop that no longer fits ends the drill quietly.
            setChunk(range ? restored.chunk : null);
            if (range) {
              followerRef.current.restoreLap(restored.lap);
              setLap(restored.lap);
            }
            setWrongCount(restored.wrongCount);
            lapWrongRef.current = restored.lapWrong;
            reportEvent(relayout ? 'relayout' : 'restore', { step: resume, loop: range ? resumeLoop : null, lap: restored.lap });
          }
          if (resume < followerRef.current.steps.length) followerRef.current.seek(resume);
          moveCursorTo(Math.min(followerRef.current.index, followerRef.current.steps.length - 1));
          // Straight there: a relaunch should look like a flicker, not a slide across the piece.
          if (restored) centerCursor('auto');
          syncUi();
          if (blockAt !== null && range && resumeLoop) startBlockRef.current(resumeLoop, blockAt);
        }
        // #6513: a piece just opened (not a fingering reload): bars anywhere in it he keeps missing join his spots.
        if ((resume === null || restored) && !relayout && steps.length) {
          checkSpotsRef.current({ first: steps[0].measure, last: steps[steps.length - 1].measure });
        }
        drawnPieceRef.current = piece.id;
        setStatus('ready');
        setDrawn((n) => n + 1);
        reportEvent('piece', {
          piece: pieceName, steps: steps.length, bars: steps[steps.length - 1]?.measure ?? 0,
          expressionMarks: exprMarksParsed.length, marked: markedBpmRef.current,
        });
      })
      .catch((err: unknown) => {
        if (disposed) return;
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setStatus('error');
      });

    return () => {
      disposed = true;
      cursorObs.disconnect();
      window.clearTimeout(flashTimerRef.current);
      try {
        osmd.cursor?.hide();
      } catch {
        /* ignore */
      }
      container.innerHTML = '';
      osmdRef.current = null;
      followerRef.current = null;
      drawnPieceRef.current = null;
      exprRef.current = null;
    };
    // piece.id too: a re-pushed piece with identical XML must still start fresh.
  }, [piece.id, drawnXml, scoreLayout, strip, everyBarNumbers, restart, buildFollower, centerCursor, showSpread, startResolved]);

  // #9976: pedal lifts, with what was ringing only on the pedal just before.
  useEffect(
    () =>
      useMidiStore.subscribe((state, prev) => {
        if (state.pedal === prev.pedal) return;
        pedalCoachRef.current.pedal(state.pedal, Date.now(), state.held, prev.pedalRinging);
      }),
    [],
  );
  useEffect(() => () => window.clearTimeout(pedalTipTimerRef.current), []);
  useEffect(() => () => window.clearTimeout(edgeTipTimerRef.current), []);

  // #5519: a credited note ends a hesitation and starts the clock on the next one.
  const noteCredit = useCallback((advanceAt: number | null) => {
    if (advanceAt !== null) {
      if (lastAdvanceRef.current !== null) {
        stepGapsRef.current = [...stepGapsRef.current.slice(1 - PACE_SAMPLES), advanceAt - lastAdvanceRef.current];
      }
      lastAdvanceRef.current = advanceAt;
    }
    setHesitating(false);
    window.clearTimeout(hesitateTimerRef.current);
    if (!useSettingsStore.getState().trainingWheels) return;
    hesitateTimerRef.current = window.setTimeout(() => setHesitating(true), hesitationMs(stepGapsRef.current));
  }, []);
  useEffect(() => () => window.clearTimeout(hesitateTimerRef.current), []);

  const flashWrong = useCallback(() => {
    setWrongFlash(true);
    window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => setWrongFlash(false), 450);
  }, []);

  // Keep going: each note is graded against the step under the clock, not the follower.
  useEffect(() => {
    if (!keeping) return;
    return useMidiStore.subscribe((state, prev) => {
      const ev = state.lastNoteOn;
      const k = keepRef.current;
      const f = followerRef.current;
      if (!ev || ev === prev.lastNoteOn || !k || !f) return;
      if (ev.velocity < useSettingsStore.getState().minVelocity) return;
      const res = keepNote(k.run, f.steps, ev.note, Date.now());
      if (res === 'hit') setKeep((s) => s && { ...s, hit: s.hit + 1 });
      else if (res === 'wrong') {
        setKeep((s) => s && { ...s, wrong: s.wrong + 1 });
        flashWrong();
        // #5799: Keep going thuds on every wrong note too.
        const played = thudMiss();
        if (played) void played.then((audio) => reportEvent('keep-miss', { audio }));
      } else if (res === 'overrun') {
        // #5945: played on past the loop's end: the thud, but no red and no wrong count.
        const played = thudMiss();
        if (played) void played.then((audio) => reportEvent('keep-overrun', { audio }));
      }
    });
  }, [keeping, flashWrong, thudMiss]);

  // --- live MIDI → follower ---
  useEffect(() => {
    if (!following || watching || keeping) return;
    return useMidiStore.subscribe((state, prev) => {
      if (watchBpmRef.current !== null) return;
      const ev = state.lastNoteOn;
      if (!ev || ev === prev.lastNoteOn) return;
      const f = followerRef.current;
      if (!f || status !== 'ready') return;
      // #5657c: while blocking, the hand-position judge below takes every key.
      if (blockRef.current) return;
      // Key first: the signature's accidentals come before the piece.
      if (keyGateRef.current || ev === keyGateEvRef.current) return;
      // Notes played for an unsolved chord task are not attempts at the piece.
      const task = useTutorStore.getState().task;
      if (task && task.result?.verdict !== 'correct') return;

      const { held, pedal, pedalRinging } = useMidiStore.getState();
      // #9999: keys still held from the last step carry over only if still down now;
      // settle that first, so this note is judged against the step it lands in.
      const keysDown = new Set(held);
      keysDown.delete(ev.note);
      const prefs = useSettingsStore.getState();
      f.grazeMs = prefs.grazeMs;
      f.minVelocity = prefs.minVelocity;
      // #5516: a stray must not confirm a carry (that could finish a lap); skip settling.
      const settled = f.strayCheck(ev.note, ev.timestamp, ev.velocity) ? null : f.settle(ev.timestamp, keysDown);
      // #5568: the step a late tie re-strike may still paint; a lap wrap clears the page.
      if (settled?.kind === 'loop' || settled?.kind === 'complete') bumpBare(closeBar);
      if (settled?.kind === 'advance' || settled?.kind === 'complete') tieLeftRef.current = settled.from;
      else if (settled?.kind === 'loop') tieLeftRef.current = null;
      if (settled?.kind === 'advance' || settled?.kind === 'loop') {
        if (settled.kind === 'loop') setMarks([]);
        moveCursorTo(settled.to);
        paintHeldTies(settled.kind === 'loop' ? (f.range?.first ?? settled.to) - 1 : settled.from, settled.to);
        if (settled.kind === 'loop') overrunRef.current = f.range ? startOverrun(f.steps, f.range.last, ev.timestamp) : null;
        // The chunk grew a bar: the cursor jumped back, so this note was not aimed at it.
        if (settled.kind === 'loop') noteAdviceLap(); // #6530 E/F
        if (settled.kind === 'loop' && chunkLap()) return;
      } else if (settled?.kind === 'complete') {
        emitRep('end'); // #6122: the whole piece, once
        spotPassRef.current();
        paintHeldTies(settled.from, f.steps.length - 1);
      }
      const idx = f.index;
      const step = f.steps[idx];
      // Spell against the step he played into, before the cursor moves on.
      const playedName = noteName(ev.note);
      const expectedNames = f.expected.map(noteName);
      // Still ringing: keys held down, plus keys let go under the sustain pedal (#9480).
      const sounding = new Set([...held, ...(pedal ? pedalRinging : [])]);
      sounding.delete(ev.note);
      trackChord(stepChordsRef.current[idx] ?? null, [ev.note, ...sounding], step?.measure);
      const gap = pedalCoachRef.current.noteOn(ev.note, ev.timestamp, {
        bar: step?.measure ?? 0,
        step: idx,
        restBefore: stepRestRef.current[idx] ?? false,
      });
      if (gap) {
        const secs = (gap.gapMs / 1000).toFixed(1);
        const text = `bar ${gap.bar}: pedal came up ${secs} s before ${playedName}; change it after you play the note`;
        setPedalTip(`Pedal came up ${secs} s before ${playedName}: lift it after you play the next note`);
        window.clearTimeout(pedalTipTimerRef.current);
        pedalTipTimerRef.current = window.setTimeout(() => setPedalTip(''), 6000);
        reportEvent('pedal-gap', { bar: gap.bar, step: gap.step, gapMs: gap.gapMs, next: playedName, text });
      }
      // #5945: the piece carrying on past the loop's end, soon after the wrap. Taken before the
      // follower judges it, so it can't reset a chord in progress or be called a graze.
      if (ev.velocity >= prefs.minVelocity && !f.expected.includes(ev.note) &&
          overrunNote(overrunRef.current, f.steps, ev.note, ev.timestamp)) {
        const played = thudMiss(); // he hears it was off, but it isn't a failure: no red, no count
        if (played) void played.then((audio) => reportEvent('overrun', { audio, note: ev.note, name: playedName, bar: step?.measure }));
        else reportEvent('overrun', { note: ev.note, name: playedName, bar: step?.measure });
        return;
      }
      const result = f.noteOn(ev.note, ev.timestamp, keysDown, ev.velocity);
      // A note that does count may be the one the continuation starts with too (C C D ...).
      if (result.kind === 'advance' || result.kind === 'partial') overrunNote(overrunRef.current, f.steps, ev.note, ev.timestamp);
      // #5568: a tied note struck again turns blue, here or at the step he just left
      // (only steps with nothing to play lie between: he has not played on yet).
      if (result.kind === 'ignored') {
        paintHeldTies(idx - 1, idx, ev.note);
        const left = tieLeftRef.current;
        if (left !== null && left < idx && f.steps.slice(left + 1, idx).every((s) => s.notes.length === 0)) {
          paintHeldTies(left - 1, left, ev.note);
        }
      }
      if (result.kind === 'advance' || result.kind === 'complete') tieLeftRef.current = result.from;
      else if (result.kind !== 'ignored' && result.kind !== 'stray' && result.kind !== 'wrong') tieLeftRef.current = null;
      // A stray (#5516) earns nothing; like a wrong note it only shows red and spoils the lap.
      const credited = result.kind !== 'wrong' && result.kind !== 'ignored' && result.kind !== 'stray';
      if (result.kind !== 'ignored') {
        const mark = placePlayed(idx, ev.note, result.kind === 'wrong' || result.kind === 'stray');
        if (mark) setMarks((m) => [...m, mark]);
      }
      reportEvent('follow', {
        note: ev.note,
        name: playedName,
        result: result.kind,
        why:
          result.kind === 'ignored'
            ? step?.ringing?.includes(ev.note)
              ? 'written note still ringing (tie or held)'
              : 'already played, carried over, or piece finished'
            : result.kind === 'stray'
              ? result.reason === 'graze'
                ? `graze: within ${f.grazeMs} ms of the last step`
                : `soft: velocity under ${f.minVelocity}`
              : undefined,
        step: idx,
        bar: step?.measure,
        velocity: ev.velocity,
        expected: expectedNames,
        pedal,
        sounding: [...sounding],
        lap: f.lap,
        // #5657 (f): the written fingers of this step, so the roll-up can say which finger misses.
        ...(result.kind === 'wrong' || result.kind === 'stray' ? { fingers: writtenFingers(stepNotesRef.current[idx]) } : {}),
      });

      const expr = exprRef.current;
      if (expr && credited) {
        if (exprNewPassRef.current) {
          expr.reset();
          exprNewPassRef.current = false;
        }
        reportExpression(expr.hit({ step: idx, note: ev.note, velocity: ev.velocity, timeMs: ev.timestamp }));
        if (result.kind === 'complete' || result.kind === 'loop') reportExpression(expr.finish());
        if (result.kind === 'loop') exprNewPassRef.current = true;
      }

      // #6530 E: what the advice rules learn from each credited note (before noteCredit moves lastAdvance).
      if (credited && step) {
        const d = adviceData();
        const n = (stepNotesRef.current[idx] ?? []).find((x) => !x.IsGraceNote && toMidi(x) === ev.note);
        if (n && ev.velocity > 0) {
          d.vel.push({ step: idx, note: ev.note, hand: staffOf(n) === 0 ? 'R' : 'L', velocity: ev.velocity, lap: d.velLap });
          if (d.vel.length > 3000) d.vel.splice(0, d.vel.length - 3000);
        }
        // Onto a new bar (not the loop's first): time per written beat over twice his usual is a pause
        // before it (per beat, so a long note or a tie ending the bar played in time is not a pause).
        if (result.kind === 'advance') {
          const prev = d.prev;
          const beats = prev ? step.beat - prev.beat : 0;
          if (prev && beats > 0) {
            const perBeat = (ev.timestamp - prev.at) / beats;
            const startBar = f.range ? f.steps[f.range.first]?.measure : f.steps[0]?.measure;
            if (step.measure !== prev.bar && step.measure !== startBar && d.perBeat.length >= 4) {
              const sorted = [...d.perBeat].sort((a, b) => a - b);
              const usual = sorted[Math.floor(sorted.length / 2)];
              const list = d.entries.get(step.measure) ?? [];
              list.push(perBeat > 2 * usual && ev.timestamp - prev.at > 600);
              d.entries.set(step.measure, list.slice(-10));
            }
            d.perBeat = [...d.perBeat.slice(-15), perBeat];
          }
          d.prev = { bar: step.measure, beat: step.beat, at: ev.timestamp };
        }
      }
      if (credited) noteCredit(result.kind === 'advance' || result.kind === 'loop' ? ev.timestamp : null);
      if (step && credited) bumpBare((r) => bareNote(r, step.measure));
      if (step && (result.kind === 'wrong' || result.kind === 'stray')) bumpBare((r) => bareMiss(r, step.measure));
      if (result.kind === 'complete' || result.kind === 'loop') bumpBare(closeBar);
      if (lapStartRef.current === null && credited) {
        runStartBarRef.current = step?.measure ?? null;
        lapStartRef.current = ev.timestamp;
      }

      switch (result.kind) {
        case 'partial':
          break;
        case 'advance':
          moveCursorTo(result.to);
          paintHeldTies(result.from, result.to);
          setFeedback({ kind: 'idle' });
          break;
        case 'loop': {
          // Lifting before jumping back to the loop's start is not a pedalling slip.
          pedalCoachRef.current.reset();
          // One lap done: its average tempo, then a clean page for the next lap.
          const range = f.range;
          const start = lapStartRef.current;
          const lapMs = range && start !== null ? ev.timestamp - start : 0;
          const bpm = range ? playedTempo(f.steps[result.from].beat - f.steps[range.first].beat, lapMs) : null;
          if (bpm) setLapBpm(bpm);
          lapStartRef.current = null;
          overrunRef.current = range ? startOverrun(f.steps, range.last, ev.timestamp) : null;
          setMarks([]);
          moveCursorTo(result.to);
          // From the loop's first step: empty steps (ties only) there were skipped.
          paintHeldTies((range?.first ?? result.to) - 1, result.to);
          setLap(result.lap);
          setFeedback({ kind: 'idle' });
          reportEvent('lap', {
            lap: result.lap, // #5853: the loop's bars and the help on screen, for the practice history
            firstBar: range ? f.steps[range.first]?.measure : null, lastBar: range ? f.steps[range.last]?.measure : null,
            hints: hintsLogRef.current?.state ?? null,
            // #6530 B: this lap's tempo and misses (chunkLap resets them just below), for speed-vs-misses.
            bpm, ms: lapMs || null, wrong: lapWrongRef.current, wrongBars: [...lapWrongBarsRef.current].sort((a, b) => a - b),
            marked: markedBpmRef.current, skipped: lapSkippedRef.current,
          });
          // #6530 D: every 3rd lap, does he miss more when this loop goes faster?
          noteAdviceLap(); // #6530 E/F
          if (range && ++lapsSinceAdviceRef.current >= 3) {
            lapsSinceAdviceRef.current = 0;
            checkAdviceRef.current({ first: f.steps[range.first].measure, last: f.steps[range.last].measure }, 'lap');
          }
          chunkLap();
          break;
        }
        case 'complete': {
          emitRep('end'); // #6122
          const fresh = freshRef.current;
          const begun = lapStartRef.current;
          const passMs = begun !== null ? ev.timestamp - begun : 0;
          const passBpm = playedTempo(f.steps[result.from].beat - f.steps[f.range?.first ?? 0].beat, passMs);
          // #6530 B: a whole pass (or a run to the end of his range) with its tempo and misses;
          // before spotPass, which clears this pass's miss bars. skipped = a scroll jump, the tempo is off.
          reportEvent('pass', {
            firstBar: runStartBarRef.current, lastBar: f.steps[result.from]?.measure ?? null,
            bpm: passBpm, ms: passMs || null, wrong: lapWrongRef.current,
            wrongBars: [...lapWrongBarsRef.current].sort((a, b) => a - b), marked: markedBpmRef.current,
            skipped: lapSkippedRef.current,
          });
          const passLast = f.steps[result.from]?.measure;
          if (runStartBarRef.current !== null && passLast !== undefined) checkAdviceRef.current({ first: runStartBarRef.current, last: passLast }, 'pass');
          {
            const d = adviceData();
            d.velLap++;
            d.prev = null;
          }
          spotPassRef.current();
          paintHeldTies(result.from, f.steps.length - 1);
          if (fresh && fresh.label === pieceLabelRef.current && passMs > 0) {
            reportEvent('fresh-done', {
              id: fresh.id, key: fresh.key, label: fresh.label, ms: passMs, wrong: wrongCountRef.current, bpm: passBpm,
            });
          }
          setFeedback({ kind: 'complete' });
          // #5521: the whole piece with no wrong note since Restart: the ding.
          if (lapWrongRef.current === 0 && useSettingsStore.getState().celebrateChime) void playLapChime();
          break;
        }
        case 'wrong': {
          setWrongCount((c) => c + 1);
          spoilLap(step?.measure);
          setFeedback({
            kind: 'wrong',
            played: result.played,
            expected: result.expected,
            remaining: result.remaining,
            hint: hintFor(osmdRef.current, stepNotesRef.current[idx] ?? [], result.remaining),
          });
          // Only his note goes red (drawn above); the panel ring flashes.
          flashWrong();
          setHesitating(true);
          break;
        }
        case 'stray':
          // #5516: no credit and the step stands; the lap just isn't clean any more.
          spoilLap(step?.measure);
          flashWrong();
          break;
        case 'ignored':
          break;
      }
      syncUi();
    });
  }, [following, watching, keeping, status, moveCursorTo, syncUi, placePlayed, paintHeldTies, noteName, trackChord, reportExpression, chunkLap, flashWrong, noteCredit, spoilLap, bumpBare]);

  // Key first: every press goes to the gate until the signature's accidentals are all played.
  const gateOn = !!keyGateNow;
  useEffect(() => {
    if (!gateOn) return;
    return useMidiStore.subscribe((state, prev) => {
      const g = keyGateRef.current;
      const ev = state.lastNoteOn;
      if (!g || !ev || ev === prev.lastNoteOn) return;
      keyGateEvRef.current = ev;
      const { gate, event } = keyGateInput(g, ev.note);
      if (event === 'wrong') flashWrong();
      if (event === 'done') {
        reportEvent('key-first', { event: 'done', fifths: g.fifths, misses: gate.misses });
        setKeyGate(null);
        return;
      }
      setKeyGate(gate);
    });
  }, [gateOn, setKeyGate, flashWrong]);

  // #5657c: while blocking, every press and release is judged against the hand position.
  const blockOn = !!block;
  // #6086: the how-to card shows itself the first time Block turns on.
  useEffect(() => {
    if (blockOn && !useSettingsStore.getState().blockTipSeen) setBlockTipOpen(true);
    if (!blockOn) setBlockTipOpen(false);
  }, [blockOn]);
  const closeBlockTip = useCallback(() => {
    setBlockTipOpen(false);
    useSettingsStore.getState().setPrefs({ blockTipSeen: true });
  }, []);
  useEffect(() => {
    if (!blockOn) return;
    return useMidiStore.subscribe((state, prev) => {
      const b = blockRef.current;
      if (!b || b.done) return;
      const ev = state.lastNoteOn;
      const pressed = ev && ev !== prev.lastNoteOn ? ev.note : undefined;
      if (pressed === undefined && state.held === prev.held) return;
      const { state: next, event } = blockInput(b, state.held, pressed);
      setBlock(next);
      if (event === 'none') return;
      const pos = b.positions[b.at];
      reportEvent('block', {
        event, position: b.at + 1, of: b.positions.length, firstBar: pos.firstBar, lastBar: pos.lastBar, clean: next.clean,
        ...(event === 'wrong' && pressed !== undefined ? { played: pressed, name: noteName(pressed) } : {}),
      });
      if (event === 'wrong' || event === 'spoiled-hold') {
        flashWrong();
        setHesitating(true);
        return;
      }
      noteCredit(null);
      // His first clean hold means he has the idea: the card can go.
      if (blockTipRef.current) closeBlockTip();
      if (event === 'next') moveCursorTo(next.positions[next.at].firstStep);
      if (event === 'done' && useSettingsStore.getState().celebrateChime) void playLapChime();
    });
  }, [blockOn, setBlock, flashWrong, noteCredit, moveCursorTo, noteName, closeBlockTip]);

  // Key releases, for the length of a fermata on the last note. A wrong note shows
  // only while its key is down (#9630), so the score doesn't fill up with red.
  useEffect(() => {
    if (!following) return;
    return useMidiStore.subscribe((state, prev) => {
      const latest = state.noteLog[0];
      if (!latest || latest === prev.noteLog[0] || latest.kind !== 'noteoff') return;
      setMarks((m) => (m.some((k) => k.wrong && k.midi === latest.note) ? m.filter((k) => !(k.wrong && k.midi === latest.note)) : m));
      const expr = exprRef.current;
      if (expr && status === 'ready') reportExpression(expr.noteOff(latest.note, latest.timestamp));
    });
  }, [following, status, reportExpression]);

  // OSMD re-renders on resize, which moves every note; drop stale marks.
  useEffect(() => {
    let timer: number | undefined;
    const onResize = () => {
      setMarks([]);
      // The re-render draws the symbols afresh (uncoloured); start the chord over.
      chordLitRef.current = noChord();
      // OSMD re-lays out after a short debounce; re-shade the loop once it has.
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setLayoutTick((t) => t + 1), 600);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.clearTimeout(timer);
    };
  }, []);

  // #6055: flipping "Big notes" re-fits from the default zoom (the render override does the fitting).
  const firstFitRef = useRef(true);
  useEffect(() => {
    if (firstFitRef.current) { firstFitRef.current = false; return; }
    const osmd = osmdRef.current;
    if (!strip || status !== 'ready' || !osmd) return;
    osmd.Zoom = 1;
    osmd.render();
    setMarks([]);
    chordLitRef.current = noChord();
    setLayoutTick((t) => t + 1);
  }, [stripFitInk]); // eslint-disable-line react-hooks/exhaustive-deps

  // Strip: the free height also changes without a window resize (Keyboard, Original, a task
  // panel), so re-fit the zoom when the panel itself changes height.
  useEffect(() => {
    const panel = panelRef.current;
    if (!strip || status !== 'ready' || !panel) return;
    let lastHeight = panel.clientHeight;
    let timer: number | undefined;
    const obs = new ResizeObserver(() => {
      if (Math.abs(panel.clientHeight - lastHeight) < 8) return;
      lastHeight = panel.clientHeight;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const osmd = osmdRef.current;
        const container = containerRef.current;
        if (!osmd || !container || !fitStrip(osmd, container, panel)) return;
        osmd.render();
        setMarks([]);
        chordLitRef.current = noChord();
        setLayoutTick((t) => t + 1);
      }, 300);
    });
    obs.observe(panel);
    return () => {
      obs.disconnect();
      window.clearTimeout(timer);
    };
  }, [strip, status]);

  // --- manual cursor controls (re-sync the follower to wherever the cursor lands) ---
  // The note under the pointer: a chord is one drawn group, so the head he is on decides,
  // else (on the stem) the head nearest the pointer.
  const noteAt = (el: Element, clientY: number): FingerTarget | null => {
    const osmd = osmdRef.current;
    const f = followerRef.current;
    if (!osmd || !f) return null;
    const gNote = (n: OsmdNote) => gNoteOf(osmd, n);
    for (let i = 0; i < f.steps.length; i++) {
      // A held note is no longer struck, so look among the held-over notes too.
      const chord = [...(stepNotesRef.current[i] ?? []), ...(tieNotesRef.current[i] ?? [])].filter((n) =>
        gNote(n)?.getSVGGElement?.()?.contains(el),
      );
      if (!chord.length) continue;
      const away = (n: OsmdNote) => {
        const r = headOf(gNote(n))?.getBoundingClientRect();
        return r ? Math.abs((r.top + r.bottom) / 2 - clientY) : Infinity;
      };
      const note =
        chord.find((n) => headOf(gNote(n))?.contains(el)) ??
        chord.reduce((best, n) => (away(n) < away(best) ? n : best));
      return targetOf(note, f.steps[i].measure);
    }
    return null;
  };

  // The written note for a target, wherever the score has been re-rendered since.
  const noteOf = (target: FingerTarget): OsmdNote | null => {
    const f = followerRef.current;
    if (!f) return null;
    for (let i = 0; i < f.steps.length; i++) {
      if (f.steps[i].measure !== target.measure) continue;
      for (const n of [...(stepNotesRef.current[i] ?? []), ...(tieNotesRef.current[i] ?? [])]) {
        const at = targetOf(n, f.steps[i].measure);
        if (at && sameTarget(at, target)) return n;
      }
    }
    return null;
  };

  // The notes of that key at the cursor (a pitch can sit in both hands at once).
  const keyTargets = (midi: number): FingerTarget[] => {
    const measure = followerRef.current?.steps[cursorStep]?.measure;
    if (measure === undefined) return [];
    return [...(stepNotesRef.current[cursorStep] ?? []), ...(tieNotesRef.current[cursorStep] ?? [])]
      .filter((n) => toMidi(n) === midi)
      .flatMap((n) => targetOf(n, measure) ?? []);
  };

  const openPick = (x: number, y: number, target: FingerTarget, alts?: FingerTarget[]) => {
    setFingerMsg('');
    const held = holdsOf(piece.xml).some((h) => sameTarget(h, target));
    setFingerPick({ x, y, target, name: noteName(target.midi), held, alts });
  };

  // #9988: tap a notehead to give it a finger number, or (#10146) mark it "hold".
  const onScoreTap = (ev: React.MouseEvent) => {
    // #5410: choosing a loop's bars, a click on a note picks its bar; no finger picker over the music.
    if (watching || picking !== 'off' || !(ev.target instanceof Element)) return;
    const hit = noteAt(ev.target, ev.clientY);
    if (hit) openPick(ev.clientX, ev.clientY, hit);
  };

  // #10236: a key on the strip opens the same picker, for that pitch at the cursor.
  const onKeyClick = (midi: number, ev: React.MouseEvent) => {
    if (watching) return;
    const [target, ...alts] = keyTargets(midi);
    if (target) openPick(ev.clientX, ev.clientY, target, alts);
    else setFingerMsg(`${noteName(midi)} isn't at the cursor.`);
  };

  const setHoverTarget = (next: FingerTarget | null) =>
    setWheelTarget((was) => (was && next && sameTarget(was, next) ? was : next));

  // The wheel over a score note edits its finger only with the switch on, not during
  // Play it for me, and not while choosing a loop's bars.
  const wheelOnScore = scoreWheelFingers && !watching && picking === 'off';
  const onScoreHover = (ev: React.MouseEvent) => {
    if (hoverKey !== null) setHoverKey(null);
    const on = wheelOnScore && ev.target instanceof Element ? noteAt(ev.target, ev.clientY) : null;
    setHoverTarget(on);
  };

  // A hovered key follows the cursor: no yellow once its pitch isn't in this step, and
  // none for a pitch in both hands, since the wheel couldn't tell which one he means.
  useEffect(() => {
    if (hoverKey === null) {
      return;
    }
    // #5630: with "Wheel fingers on keyboard" off, the wheel over a key only scrolls.
    const hits = keyWheelFingers && !watching && picking === 'off' ? keyTargets(hoverKey) : [];
    setHoverTarget(hits.length === 1 ? hits[0] : null);
  }, [hoverKey, cursorStep, watching, picking, drawn, keyWheelFingers]);

  // A save or a re-fit redraws the score under a pointer that hasn't moved: find what it's on
  // again, or the next notch of the same spin would scroll instead of edit.
  const pointerRef = useRef({ x: -1, y: -1 });
  useEffect(() => {
    const track = (ev: MouseEvent) => {
      pointerRef.current = { x: ev.clientX, y: ev.clientY };
    };
    document.addEventListener('mousemove', track, { passive: true });
    return () => document.removeEventListener('mousemove', track);
  }, []);
  useEffect(() => {
    if (status !== 'ready') return;
    const { x, y } = pointerRef.current;
    const el = x < 0 ? null : document.elementFromPoint(x, y);
    const midi = el?.getAttribute('data-midi');
    if (midi) setHoverKey(Number(midi));
    else if (el && containerRef.current?.contains(el) && wheelOnScore) {
      setHoverTarget(noteAt(el, y));
    }
  }, [drawn, layoutTick]);

  // #5652 C Read ahead: the notes at the cursor vanish as it reaches them, so he has to have read
  // them already. Not the run's first step (nothing came before it to read from), and they come
  // back after a wrong note or a pause, the way hints do.
  const blankStep = readAhead && status === 'ready' && feedback.kind !== 'complete' && !hesitating && !watching
    && cursorStep !== (followerRef.current?.range?.first ?? 0)
    ? cursorStep
    : null;
  useEffect(() => {
    const osmd = osmdRef.current;
    if (!osmd || blankStep === null) return;
    const blanked: SVGGElement[] = [];
    for (const n of stepNotesRef.current[blankStep] ?? []) {
      const el = gNoteOf(osmd, n)?.getSVGGElement?.();
      if (!el || blanked.includes(el)) continue;
      el.style.visibility = 'hidden';
      blanked.push(el);
    }
    setBlanked(blanked.length);
    return () => {
      for (const el of blanked) el.style.visibility = '';
      setBlanked(0);
    };
  }, [blankStep, drawn, layoutTick]);

  // Paint the note being edited, and take the paint off afterwards so its colour survives.
  useEffect(() => {
    const osmd = osmdRef.current;
    if (!osmd || status !== 'ready') return;
    const painted: { el: SVGElement; fill: string; stroke: string }[] = [];
    for (const target of [wheelTarget, fingerPick?.target]) {
      const note = target && noteOf(target);
      const head = note && headOf(gNoteOf(osmd, note));
      if (!head) continue;
      for (const el of [head, ...head.querySelectorAll('*')] as SVGElement[]) {
        painted.push({ el, fill: el.style.fill, stroke: el.style.stroke });
        el.style.fill = EDIT_YELLOW;
        el.style.stroke = EDIT_OUTLINE;
      }
    }
    return () => {
      for (const { el, fill, stroke } of painted.reverse()) {
        el.style.fill = fill;
        el.style.stroke = stroke;
      }
    };
  }, [wheelTarget, fingerPick?.target, drawn, layoutTick]);

  // Re-render with the edited score where he is (loop kept, #10134).
  const showEditedXml = (xml: string) => {
    resumeStepRef.current = cursorIndexRef.current;
    resumeLoopRef.current = loopBars;
    setXmlEdits((e) => ({ ...e, [piece.id]: xml }));
  };

  // #10146: mark the picked note "hold, don't re-strike", or take the mark off.
  const applyHold = (on: boolean) => {
    const pick = fingerPick;
    setFingerPick(null);
    if (!pick) return;
    const result = setHold(piece.xml, pick.target, on);
    if (!result.ok) {
      setFingerMsg(`Couldn't change that note: ${result.reason}`);
      return;
    }
    showEditedXml(result.xml);
    const what = on ? `${pick.name} is held from before, not struck again` : `${pick.name} is struck again`;
    reportEvent('hold', { ...pick.target, on, name: pick.name });
    const bridge = window.tutorBridge;
    if (!scanSlug || !bridge?.writeScore) {
      setFingerMsg(`${what} (this session only: the piece has no file to save to).`);
      return;
    }
    void bridge
      .writeScore(scanSlug, result.xml)
      .then(() => setFingerMsg(`${what}: saved here (a re-sync from the desk would undo it).`))
      .catch((err: unknown) => setFingerMsg(`${what}, but saving failed: ${err instanceof Error ? err.message : String(err)}`));
  };

  const applyFinger = (digit: Digit | null) => {
    const pick = fingerPick;
    setFingerPick(null);
    if (pick) writeFinger(pick, digit);
  };

  // #10258: change the mark in OSMD's own score and lay it out again, in one go: nothing paints
  // until it's done, and the follower, cursor and loop are never rebuilt. False: do a full reload.
  const setFingerInPlace = (target: FingerTarget, digit: Digit | null): boolean => {
    const osmd = osmdRef.current;
    const note = noteOf(target);
    const marks = note?.ParentVoiceEntry?.TechnicalInstructions;
    if (!osmd || !note || !marks) return false;
    const mark = note.Fingering as TechnicalInstruction | null | undefined;
    if (mark && digit) {
      const was = mark.value;
      mark.value = digit;
      if (swapFingerLabel(osmd, note, was, digit)) {
        setZoneTick((t) => t + 1);
        return true;
      }
    } else if (mark) {
      marks.splice(marks.indexOf(mark), 1);
      note.Fingering = null;
    } else if (digit) {
      const added = new TechnicalInstruction();
      added.type = TechnicalInstructionType.Fingering;
      added.value = digit;
      added.sourceNote = note as unknown as TechnicalInstruction['sourceNote'];
      marks.push(added);
      note.Fingering = added;
    }
    const began = performance.now();
    osmd.render();
    performance.measure('finger-render', { start: began, end: performance.now() });
    // The symbols were drawn afresh, uncoloured, as on a resize.
    chordLitRef.current = noChord();
    setLayoutTick((t) => t + 1);
    return true;
  };

  const writeFinger = (pick: { target: FingerTarget; name: string }, digit: Digit | null) => {
    const result = setFingering(piece.xml, pick.target, digit);
    if (!result.ok) {
      setFingerMsg(`Couldn't change that note's finger: ${result.reason}`);
      return;
    }
    if (setFingerInPlace(pick.target, digit)) {
      quietXmlRef.current = result.xml;
      setXmlEdits((e) => ({ ...e, [piece.id]: result.xml }));
    } else {
      showEditedXml(result.xml);
    }
    const what = digit ? `Finger ${digit} on ${pick.name}` : `Finger removed from ${pick.name}`;
    reportEvent('fingering', { ...pick.target, digit, name: pick.name });
    setSpreadFrom(digit ? { target: pick.target, name: pick.name } : null);
    const bridge = window.tutorBridge;
    if (!scanSlug || !bridge?.writeScore) {
      setFingerMsg(`${what} (this session only: the piece has no file to save to).`);
      return;
    }
    const slug = scanSlug;
    void bridge
      .writeScore(slug, result.xml)
      .then(() => (scanLayout && bridge.reviewAppend ? bridge.reviewAppend(slug, { kind: 'fingering', ...pick.target, digit }) : null))
      .then((sent) => setFingerMsg(sent
        ? `${what}: saved; the library copy updates next time Review runs on the desk.`
        : `${what}: saved here (no scan review for this piece, so a re-sync from the desk will undo it).`))
      .catch((err: unknown) => setFingerMsg(`${what}, but saving failed: ${err instanceof Error ? err.message : String(err)}`));
  };

  // #5947: every other spot with exactly these pitches (same staff, same octave) gets this spot's
  // whole fingering; a note that already has a different finger is kept. There is no undo, so the
  // button shows what it will do first.
  const spreadPlan = useMemo(() => (spreadFrom ? planSpread(piece.xml, spreadFrom.target) : null), [spreadFrom, piece.xml]);
  const spreadAll = () => {
    const from = spreadFrom;
    setSpreadFrom(null);
    if (!from) return;
    const result = spreadFingering(piece.xml, from.target);
    if (!result.ok) {
      setFingerMsg(`Couldn't apply to the others: ${result.reason}`);
      return;
    }
    showEditedXml(result.xml);
    const kept = result.skipped ? `, kept ${result.skipped} you fingered differently` : '';
    const what = `Fingered ${result.applied} more note${result.applied === 1 ? '' : 's'} like ${from.name}${kept}`;
    reportEvent('fingering-spread', { ...from.target, applied: result.applied, skipped: result.skipped, spots: result.spots });
    const bridge = window.tutorBridge;
    if (!scanSlug || !bridge?.writeScore) {
      setFingerMsg(`${what} (this session only: the piece has no file to save to).`);
      return;
    }
    const slug = scanSlug;
    const append = scanLayout && bridge.reviewAppend ? bridge.reviewAppend : null;
    void bridge
      .writeScore(slug, result.xml)
      .then(async () => {
        for (const c of result.changes) await append?.(slug, { kind: 'fingering', measure: c.measure, staff: c.staff, onset: c.onset, midi: c.midi, digit: c.digit });
      })
      .then(() => setFingerMsg(`${what}: saved.`))
      .catch((err: unknown) => setFingerMsg(`${what}, but saving failed: ${err instanceof Error ? err.message : String(err)}`));
  };

  const prevStep = () => {
    const f = followerRef.current;
    if (!f) return;
    const target = prevPlayable(f.steps, cursorIndexRef.current);
    if (target !== null) manualMove(target - cursorIndexRef.current);
  };

  const manualMove = (delta: number) => {
    const f = followerRef.current;
    if (!f) return;
    const target = Math.max(0, Math.min(f.steps.length - 1, cursorIndexRef.current + delta));
    f.seek(target);
    pedalCoachRef.current.reset();
    // A jump starts a new pass: spans he skipped must not be judged.
    exprRef.current?.reset();
    adviceDataRef.current.prev = null; // #6530 E: the time spent jumping is not a pause before a bar
    moveCursorTo(Math.min(f.index, f.steps.length - 1));
    setFeedback({ kind: 'idle' });
    syncUi();
  };

  // Once the picked piece is drawn with its hand's steps: its bars. keepChunk because this isn't a
  // range he chose, so it stays out of pieceLoops, which homework lines open on.
  useEffect(() => {
    if (!pendingSight || pendingSight !== piece.id || drawnPieceRef.current !== piece.id || status !== 'ready') return;
    setPendingSight(null);
    const bars = pickBars(followerRef.current?.steps.map((st) => st.measure) ?? []);
    const handName = hand === 'both' ? 'both hands' : `${hand} hand`;
    if (!bars) {
      setSightMsg(`${pieceName}: nothing to play in the ${handName}. Press again for another.`);
      return;
    }
    applyLoop(bars, true);
    setSightMsg(`${pieceName}: ${handName}, bars ${bars.first}-${bars.last}. Press again for another.`);
    reportEvent('sight-read', { piece: pieceName, hand, firstBar: bars.first, lastBar: bars.last });
  }, [pendingSight, piece.id, status, drawn]);

  // The bar field: straight to that bar's first note. No such bar: the field goes back.
  const jumpToBar = (bar: number) => {
    const f = followerRef.current;
    const step = f ? stepOfBar(f.steps, bar, 0) : null;
    if (step !== null) manualMove(step - cursorIndexRef.current);
  };

  // The wheel's number lands once he stops, so a spin is one re-render and one file write.
  const commitWheel = () => {
    window.clearTimeout(wheelTimerRef.current);
    const pending = wheelPendingRef.current;
    wheelPendingRef.current = null;
    setWheelLive(null);
    if (pending && pending.pieceId === piece.id) {
      writeFinger({ target: pending.target, name: noteName(pending.target.midi) }, pending.digit);
    }
  };
  const commitWheelRef = useRef(commitWheel);
  commitWheelRef.current = commitWheel;

  // #5410: centre the bar next to the one now mid-panel. Instant, so a fast spin reads the
  // position it just set rather than one still animating.
  const slideStripBar = (way: -1 | 1) => {
    const osmd = osmdRef.current;
    const container = containerRef.current;
    const panel = panelRef.current;
    if (!osmd || !container || !panel) return;
    const p = panel.getBoundingClientRect();
    const middle = p.left + panel.clientLeft + panel.clientWidth / 2;
    const svg = container.querySelector('svg');
    if (!svg) return;
    const originX = svg.getBoundingClientRect().left;
    const bars = [...barBoxes(osmd).values()];
    if (bars.length === 0) return;
    const at = bars.findIndex((b) => middle < originX + b.x + b.w);
    const here = at < 0 ? bars.length - 1 : at;
    const next = bars[Math.max(0, Math.min(bars.length - 1, here + way))];
    panel.scrollLeft += originX + next.x + next.w / 2 - middle;
  };

  // #10237 #10238: on a yellow note the wheel steps its finger; anywhere else it scrolls.
  // The strip has no scroll of its own, so there it goes a bar at a time.
  const onWheel = (ev: WheelEvent) => {
    const f = followerRef.current;
    if (!f || status !== 'ready') return;
    // #10254: a bar he typed and hasn't landed goes now, or leaving the box later would jump him
    // back to it. If that moved him, this notch is spent: the note under the pointer has gone.
    const typing = document.activeElement;
    if (typing instanceof HTMLInputElement && typing.dataset.barInput !== undefined) {
      const at = cursorIndexRef.current;
      typing.blur();
      if (cursorIndexRef.current !== at) {
        ev.preventDefault();
        setHoverTarget(null);
        return;
      }
    }
    // Choosing a loop's bars edits no finger, even if a note was yellow as he started.
    const target = picking === 'off' ? wheelTarget : null;
    // #6373: in Pages, a notch off the notes turns a spread.
    if (!target && scoreLayout === 'pages') {
      ev.preventDefault();
      const n = wheelNotch(wheelAccRef.current, ev.deltaMode === 1 ? ev.deltaY * 40 : ev.deltaY, performance.now());
      if (n !== 0) turnSpread(reverseWheel ? -n : n);
      return;
    }
    if (!target && !strip) return;
    ev.preventDefault();
    // macOS turns a Shift+wheel into a sideways scroll: the notch arrives as deltaX.
    const delta = ev.shiftKey && !ev.deltaY ? ev.deltaX : ev.deltaY;
    const notch = wheelNotch(wheelAccRef.current, ev.deltaMode === 1 ? delta * 40 : delta, performance.now());
    if (notch === 0) return;
    const up = notch < 0;
    if (!target) {
      const way = reverseWheel ? (-notch as -1 | 1) : notch;
      // #5410: choosing a loop's bars, the wheel slides the music a bar per notch to find the
      // next one. The cursor stays where it is.
      if (picking !== 'off') {
        slideStripBar(way);
        return;
      }
      // #10259: one note per notch. The loop itself never changes; the wheel stops at its edges,
      // and Shift+wheel goes past them to tag notes outside it. #5560: so does a notch after a
      // pause at the edge, for one hand on a trackball.
      if (watching) return;
      // #6369: the plain wheel only looks: the music slides a bar a notch and his place stays.
      // The next note he plays, or Esc, brings it back. Shift+wheel (or "Wheel moves my place")
      // steps the place a note a notch, as before.
      if (!wheelSteps && !ev.shiftKey) {
        slideStripBar(way);
        setLooking(true);
        return;
      }
      setLooking(false);
      const from = cursorIndexRef.current;
      // With looking on the plain wheel, Shift is the stepping, so it keeps the loop's edges (#5560 pause).
      const range = (!wheelSteps || !ev.shiftKey) && loopBars ? stepRangeOf(f.steps, loopBars.first, loopBars.last) : null;
      let step = stepForWheel(f.steps, from, way, range || null);
      const past = range && step === null ? stepForWheel(f.steps, from, way, null) : null;
      if (past !== null) {
        window.clearTimeout(edgeTipTimerRef.current);
        // When he turned the wheel, not when a busy page got to it: a fast spin stays fast.
        if (passLoopEdge(edgeRef.current, from, way, ev.timeStamp)) {
          setEdgeTip(null);
          step = past;
        } else {
          setEdgeTip({ x: ev.clientX, y: ev.clientY });
          edgeTipTimerRef.current = window.setTimeout(() => setEdgeTip(null), 4000);
        }
      }
      // A step inside the loop forgets the last stop, so coming back to the edge stops again.
      if (past === null) edgeRef.current.from = -1;
      if (step === null) return;
      setEdgeTip(null);
      // Notes skipped by scrolling mustn't earn a clean lap in Build backwards, or count for a spot.
      if (chunk) lapWrongRef.current++;
      lapSkippedRef.current = true;
      manualMove(step - cursorIndexRef.current);
      return;
    }
    if (wheelPendingRef.current && !sameTarget(wheelPendingRef.current.target, target)) commitWheel();
    const pending = wheelPendingRef.current;
    const digit = nextFinger(pending ? pending.digit : noteOf(target)?.Fingering?.value?.trim(), up);
    wheelPendingRef.current = { pieceId: piece.id, target, digit };
    setWheelLive({ x: ev.clientX, y: ev.clientY, target, digit });
    window.clearTimeout(wheelTimerRef.current);
    wheelTimerRef.current = window.setTimeout(() => commitWheelRef.current(), 400);
  };
  const onWheelRef = useRef(onWheel);
  onWheelRef.current = onWheel;
  useEffect(() => {
    const listen = (ev: WheelEvent) => onWheelRef.current(ev);
    const areas = [panelRef.current, keyStripRef.current];
    // Not passive: over a note the score must not move as well.
    for (const a of areas) a?.addEventListener('wheel', listen, { passive: false });
    return () => {
      for (const a of areas) a?.removeEventListener('wheel', listen);
    };
  }, [showKeyboard]);
  useEffect(() => () => commitWheelRef.current(), []);

  // Red on the strip while a wrong key is down. The latest wrong note counts even when
  // the overlay could not place a mark for it on the staff.
  const wrongKeys = new Set(
    [...marks.flatMap((m) => (m.wrong && m.midi !== undefined ? [m.midi] : [])), ...(feedback.kind === 'wrong' ? [feedback.played] : [])].filter(
      (k) => held.has(k),
    ),
  );
  // #5514: on the loop's first step to play, the chord tied over into it from an earlier
  // bar shows as "hold these" (it still needn't be struck), so he can pick it up mid-way.
  const tiedKeys = new Set<number>();
  const tiedLabels = new Map<number, string>();
  // #11555: the keys whose finger numeral is the left hand's (staff 2), drawn black; right is white.
  const leftKeys = new Set<number>();
  const loopRange = followerRef.current?.range;
  if (loopRange && !watching && cursorStep >= loopRange.first &&
      followerRef.current!.steps.slice(loopRange.first, cursorStep).every((st) => st.notes.length === 0)) {
    for (let i = loopRange.first; i <= cursorStep; i++) {
      for (const n of tieNotesRef.current[i] ?? []) {
        tiedKeys.add(toMidi(n));
        // #5562: the finger is written on the note the tie starts from.
        const start = (n.NoteTie?.StartNote ?? n) as OsmdNote;
        const finger = start.Fingering?.value?.trim() || n.Fingering?.value?.trim();
        if (finger) tiedLabels.set(toMidi(n), finger);
        if (staffOf(start) === 1) leftKeys.add(toMidi(n));
      }
    }
  }
  // #5519: with training wheels, the keys he's to play show only in his run's first bar,
  // on a hesitation, or after a wrong note. Red and his own held keys always show.
  const atRunStart = lapStartRef.current === null || followerRef.current?.steps[cursorStep]?.measure === runStartBarRef.current;
  const hints = !keeping && (bareNow
    ? watching
    : readAhead
    ? watching || hesitating
    : quietNew
    ? watching || hesitating || !!wheelLive
    : !trainingWheels || watching || hesitating || atRunStart || !!wheelLive);

  // #5624: the notes to play now, as written, on a scrap of staff above the keyboard;
  // one small staff over each hand's keys (#11091), with the notes as written (#11092).
  const miniStaff = useSettingsStore((s) => s.miniStaff);
  // #5853: log which help is on screen whenever it changes (and on each piece), so the practice
  // history can tell a stretch played with the keyboard lights and hints off.
  const hintState = hintsSnapshot({ showKeyboard, trainingWheels, miniStaff, hintsOffNew, quietNew, bare: !!bareNow, readAhead, keeping });
  const hintsLogRef = useRef<{ piece: string; state: HintsSnapshot } | null>(null);
  useEffect(() => {
    const last = hintsLogRef.current;
    if (status !== 'ready' || (last?.piece === piece.label && sameHints(last.state, hintState))) return;
    hintsLogRef.current = { piece: piece.label, state: hintState };
    reportEvent('hints', { piece: piece.label, bar: followerRef.current?.steps[cursorStep]?.measure ?? null, ...hintState });
  });
  const mini = useMemo(() => {
    const osmd = osmdRef.current;
    const notes = (stepNotesRef.current[cursorStep] ?? []).filter((n) => !n.IsGraceNote);
    const rests = stepRestsRef.current[cursorStep] ?? [];
    if (!miniStaff || status !== 'ready' || !osmd || notes.length === 0 || (hintsOff && !hints)) return null;
    const lengthOf = (n: OsmdNote) => miniDuration(n.TypeLength?.RealValue, n.DotsXml, n.Length?.RealValue);
    const bar = followerRef.current?.steps[cursorStep]?.measure ?? 1;
    const part = (staff: number): MiniStaffPart & { pct: number } => {
      const mine = notes.filter((n) => staffOf(n) === staff);
      const gm = osmd.GraphicSheet.MeasureList[bar - 1]?.[staff] as unknown as OsmdMeasure | undefined;
      const clef = gm ? (gm.InitiallyActiveClef?.ClefType === 1 ? 'bass' : 'treble') : staff === 1 ? 'bass' : 'treble';
      return {
        clef,
        // A hand that only rests sits over its usual octave: around C5 right, C3 left.
        pct: mine.length
          ? mine.reduce((sum, n) => sum + keyCenterPct(toMidi(n)), 0) / mine.length
          : keyCenterPct(staff === 0 ? 72 : 48),
        notes: mine.flatMap((n) => {
          const w = writtenOf(n);
          if (!w) return [];
          const accidental = w.alter > 0 ? 'sharp' as const : w.alter < 0 ? 'flat' as const : undefined;
          return [{
            note: w.letter, accidental, octave: w.octave, midiNumber: toMidi(n), ...lengthOf(n),
            tie: !!n.NoteTie && n.NoteTie.StartNote === n,
          }];
        }),
        rest: (() => {
          const r = rests.find((n) => staffOf(n) === staff);
          return r ? lengthOf(r) : undefined;
        })(),
      };
    };
    return miniStaffPlacements(part(0), part(1));
  }, [miniStaff, status, cursorStep, stepsVersion, hintsOff, hints]);
  // #5657c: while blocking, the keyboard shows the whole hand position with its fingers;
  // with training wheels it fades after his first clean hold and comes back on a slip.
  const blockPos = block ? blockPosition(block) : null;
  const blockHints = !!block && !bareNow && !readAhead && (quietNew ? hesitating : !trainingWheels || showKeys(block, hesitating));
  const blockLabels = blockPos && blockHints
    ? new Map(blockPos.fingers.flatMap((n) => (n.finger ? [[n.midi, n.finger] as [number, string]] : [])))
    : undefined;
  const finished = feedback.kind === 'complete';
  const lastBar = followerRef.current?.steps.at(-1)?.measure;
  const firstPieceBar = followerRef.current?.steps[0]?.measure;
  // #6460: his trouble spots on this piece, open ones first.
  const spotList = prune(pieceSpots, localDay()).sort((a, b) => Number(!!a.ticked) - Number(!!b.ticked) || a.first - b.first);
  const openSpots = spotList.filter((sp) => !sp.ticked).length;
  // #6371: his starred ranges on this piece, shortest first.
  const starred = starsInOrder(starsOf(pieceStars, piece.label));
  // #6530: the latest join of his spots, if its loop is still on the list as joined.
  const lastMerge = (() => {
    const list = own(spotMerges, piece.label);
    const m = list[list.length - 1];
    return m && pieceSpots.some((sp) => !sp.ticked && sp.first === m.to.first && sp.last === m.to.last) ? m : null;
  })();
  const overallStarred = !!overall && starred.some((sp) => sp.first === overall.first && sp.last === overall.last);
  // #6513: stars and spots as one list by bar; a range that is both shows once. Ticked spots go last.
  const loopRows = (() => {
    const rows = new Map<string, { first: number; last: number; star: boolean; spot?: (typeof spotList)[number] }>();
    for (const sp of starred) rows.set(`${sp.first}-${sp.last}`, { first: sp.first, last: sp.last, star: true });
    for (const sp of spotList) {
      const row = rows.get(`${sp.first}-${sp.last}`);
      if (row) row.spot = sp;
      else rows.set(`${sp.first}-${sp.last}`, { first: sp.first, last: sp.last, star: false, spot: sp });
    }
    const done = (r: { star: boolean; spot?: { ticked?: unknown } }) => Number(!!r.spot?.ticked && !r.star);
    return [...rows.values()].sort((x, y) => done(x) - done(y) || x.first - y.first || x.last - y.last);
  })();
  const loopCount = loopRows.filter((r) => r.star || (r.spot && !r.spot.ticked)).length;
  const keyLabels = fingersOf(stepNotesRef.current[cursorStep]);
  for (const n of stepNotesRef.current[cursorStep] ?? []) if (staffOf(n) === 1) leftKeys.add(toMidi(n));
  for (const n of blockPos?.fingers ?? []) if (n.hand === 'L') leftKeys.add(n.midi);
  if (wheelLive && hoverKey === wheelLive.target.midi) {
    if (wheelLive.digit) keyLabels.set(hoverKey, wheelLive.digit);
    else keyLabels.delete(hoverKey);
    if (wheelLive.target.staff === 2) leftKeys.add(hoverKey);
    else leftKeys.delete(hoverKey);
  }
  const btn =
    'rounded-md px-3 py-1 text-sm font-medium disabled:opacity-40 bg-gray-800 text-gray-200 hover:bg-gray-700';
  const showPhoto = view === 'photo' && !!piece.photo;

  const openPiece = async () => {
    setOpenError('');
    try {
      const opened = await window.tutorBridge?.openPiece();
      if (opened) useTutorStore.getState().addPiece({ label: opened.title, xml: opened.musicxml });
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : String(err));
    }
  };

  const loopBtn = picking !== 'off' || loopBars ? 'bg-yellow-500 text-gray-950 hover:bg-yellow-400' : '';

  // #6062: which controls are ON, whether or not they are on the front row (the "N on" count on More).
  const controlOn = (id: string): boolean => ({
    hand: hand !== 'both', layout: scoreLayout !== 'strip', follow: following, keyboard: showKeyboard,
    loopBars: !!loopBars || picking !== 'off', watch: watching, keepGoing: keeping, missSound,
    simple: simplePieces.includes(piece.label), bare: !!bareNow, handZones: zonesOn, chordMoves: chordsOn,
    trainingWheels: showKeyboard && trainingWheels, miniStaff: showKeyboard && miniStaff, readAhead,
    scoreWheelFingers, keyWheelFingers, everyBarNumbers: !strip && everyBarNumbers, bigNotes: strip && stripFitInk,
    reverseWheel: strip && reverseWheel,
  } as Partial<Record<string, boolean>>)[id] ?? false;
  const corral = useCorral(ORDER, staticFront, controlOn);

  // #6054: every movable toolbar control, by id; toolbarPlacement.ts says where each one is shown.
  const controls: Record<ControlId, ReactNode> = {
    hand: (
      <>
        <div role="group" aria-label="Hand" className="flex overflow-hidden rounded-md border border-gray-700 text-sm">
          {(['both', 'right', 'left'] as const).map((value) => (
            <button
              key={value}
              data-testid={`hand-${value}`}
              aria-pressed={hand === value}
              disabled={staffCount < 2}
              onClick={() => {
                if (hand === value) return;
                setHand(value);
                reportEvent('hand', { hand: value });
              }}
              className={`px-2 py-1 ${
                hand === value ? 'bg-sky-600 text-white' : 'bg-gray-900 text-gray-300 hover:bg-gray-800'
              }`}
            >
              {value === 'both' ? 'Both' : value === 'right' ? 'Right' : 'Left'}
            </button>
          ))}
        </div>
      </>
    ),
    layout: (
      <>
        <div role="group" aria-label="Layout" data-testid="layout-toggle" className="flex overflow-hidden rounded-md border border-gray-700 text-sm">
          {([
            ['strip', 'Strip', 'One long line of music that slides along as you play'],
            ['pages', 'Two pages', 'Two whole pages side by side, like the printed music, with no title block; opens on your loop. P flips here and back.'],
            ['scroll', 'Scroll', 'One long page that scrolls down'],
          ] as const).map(([value, label, title]) => (
            <button
              key={value}
              data-testid={`layout-${value}`}
              aria-pressed={scoreLayout === value}
              title={title}
              onClick={() => setScoreLayout(value)}
              className={`px-2 py-1 ${
                scoreLayout === value ? 'bg-sky-600 text-white' : 'bg-gray-900 text-gray-300 hover:bg-gray-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </>
    ),
    follow: (
      <>
        <label className="ml-2 flex items-center gap-1.5 text-sm text-gray-300">
          <input type="checkbox" checked={following} onChange={(e) => setFollowing(e.target.checked)} />
          Follow my playing
        </label>
      </>
    ),
    keyboard: (
      <>
        <label className="ml-2 flex items-center gap-1.5 text-sm text-gray-300">
          <input type="checkbox" checked={showKeyboard} onChange={(e) => setShowKeyboard(e.target.checked)} />
          Keyboard
        </label>
      </>
    ),
    loopBars: (
      <>
          <button
            onClick={() => {
              setPicking(picking === 'off' ? 'start' : 'off');
              setPickStart(null);
            }}
            disabled={status !== 'ready' || watching || keeping}
            className={`${btn} ${loopBtn}`}
            data-testid="loop-bars"
          >
            {picking === 'start' ? 'Click first bar…' : picking === 'end' ? 'Click last bar…' : 'Loop bars'}
          </button>
          {loopBars && (
            <button onClick={() => applyLoop(null)} disabled={watching || keeping} className={btn} data-testid="clear-loop">
              Clear loop
            </button>
          )}
          {loopBars && (
            <button
              onClick={toggleBackwards}
              disabled={watching || !!block || !!chunk?.out || (!chunk && loopBars.first === loopBars.last)}
              className={`${btn} ${chunk && !chunk.out ? 'bg-yellow-500 text-gray-950 hover:bg-yellow-400' : ''}`}
              title="Loop the last bar; after enough clean laps, add the bar before it, until the whole loop"
              data-testid="build-backwards"
            >
              {chunk && !chunk.out ? 'Backwards: on' : 'Build backwards'}
            </button>
          )}
          {loopBars && (
            <button
              onClick={toggleOutward}
              disabled={watching || !!block || (!!chunk && !chunk.out) || (!chunk && loopBars.first === firstPieceBar && loopBars.last === lastBar)}
              className={`${btn} ${chunk?.out ? 'bg-yellow-500 text-gray-950 hover:bg-yellow-400' : ''}`}
              title="Loop just this spot; after enough clean laps, add a bar on each side, until it fills the smallest starred range around it (or the whole piece)"
              data-testid="build-outward"
            >
              {chunk?.out ? 'Outward: on' : 'Build outward'}
            </button>
          )}
          {loopBars && (
            <button
              onClick={lesson ? () => stopLesson('button') : startLesson}
              disabled={watching || keeping || !!block || !!chunk || (!lesson && !lessonReady)}
              className={`${btn} ${lesson ? 'bg-yellow-500 text-gray-950 hover:bg-yellow-400' : ''}`}
              title={lesson ? 'Stop the lesson plan: back to your own loop'
                : lessonReady ? 'Loops the rough spots of your last laps one by one until clean, then the whole loop'
                  : `Play the loop ${LESSON_MIN_LAPS} times first`}
              data-testid="lesson-plan"
            >
              {lesson ? 'Stop lesson plan' : 'Lesson plan'}
            </button>
          )}
          {chunk && (
            <label className="flex items-center gap-1 text-sm text-gray-300" title="Clean laps per chunk: first, then every later one">
              Clean laps
              <input
                value={backwardTargets}
                onChange={(e) => setBackwardTargets(e.target.value)}
                className="w-14 rounded bg-gray-800 px-1 font-mono text-gray-100"
                data-testid="backwards-targets"
              />
            </label>
          )}
          {loopBars && !chunk && (
            <button
              onClick={toggleBlock}
              disabled={watching || keeping}
              className={`${btn} ${block ? 'bg-yellow-500 text-gray-950 hover:bg-yellow-400' : ''}`}
              title="Press each hand position of the loop as one chord: hold, let go, three clean holds, then the next position. No timing."
              data-testid="block"
            >
              {block ? 'Block: on' : 'Block'}
            </button>
          )}
          {loopBars && !chunk && block && (
            <button
              onClick={() => setBlockTipOpen((o) => !o)}
              className={btn}
              title="How Block works"
              aria-label="How Block works"
              data-testid="block-help"
            >
              ?
            </button>
          )}
      </>
    ),
    prev: (
      <>
          <button onClick={prevStep} disabled={status !== 'ready' || watching || keeping} className={btn}>
            ◀ Prev
          </button>
      </>
    ),
    next: (
      <>
          <button onClick={() => manualMove(1)} disabled={status !== 'ready' || finished || watching} className={btn}>
            Next ▶
          </button>
      </>
    ),
    watch: (
      <>
          <button onClick={toggleWatch} disabled={status !== 'ready' || keeping} className={btn} data-testid="watch">
            {watching ? '■ Stop' : '▶ Play it for me'}
          </button>
      </>
    ),
    keepGoing: (
      <>
          <span
            className="flex items-center gap-1"
            title="Keep going: the cursor moves on the beat whether you play or not, so you play on past mistakes. Your loop goes round lap after lap; with no loop, the whole piece once. A bar of clicks counts you in."
          >
            <button
              onClick={toggleKeep}
              disabled={status !== 'ready' || watching || !!block}
              className={`${btn} ${keeping ? 'ring-2 ring-amber-400' : ''}`}
              data-testid="keep-going"
            >
              {keeping ? '■ Stop' : '⏵ Keep going'}
            </button>
            <span className="text-xs text-gray-400">♩ =</span>
            <input
              type="number"
              min={20}
              max={240}
              value={keepBpm}
              disabled={keeping}
              onChange={(e) => setKeepBpm(Number(e.target.value) || 60)}
              onBlur={() => {
                const b = clampBpm(keepBpm);
                setKeepBpm(b);
                useSettingsStore.getState().setKeepBpm(pieceLabelRef.current, b);
              }}
              className="w-14 rounded bg-gray-800 px-1 text-sm text-gray-100 disabled:opacity-50"
              data-testid="keep-bpm"
            />
          </span>
          {/* #6530 C: tempo climb: Keep going starts lower and works up to the target as his laps come clean. */}
          <span
            className="flex items-center gap-1 text-xs text-gray-400"
            title="Climb: Keep going starts at your last tempo here (or 70% of the target) and goes up after clean laps, down after rough ones, until you reach the target. The target starts as your teacher's homework tempo or the score's marked tempo. How fast it reacts is in Practice settings."
          >
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={climbOn}
                disabled={keeping}
                onChange={(e) => useSettingsStore.getState().setPrefs({ climbOn: e.target.checked })}
                data-testid="climb-on"
              />
              Climb to ♩
            </label>
            <input
              type="number"
              min={20}
              max={240}
              value={climbTarget}
              disabled={keeping || !climbOn}
              onChange={(e) => useSettingsStore.getState().setClimbTarget(piece.label, Number(e.target.value) || climbTarget)}
              onBlur={() => {
                // Only a target he typed is saved, so a later homework tempo still wins over a mere look.
                const st = useSettingsStore.getState();
                if (st.climbTargets[piece.label] !== undefined) st.setClimbTarget(piece.label, clampBpm(climbTarget));
              }}
              className="w-14 rounded bg-gray-800 px-1 text-sm text-gray-100 disabled:opacity-50"
              data-testid="climb-target"
            />
            {climb && (
              <span className="flex items-center gap-1" data-testid="climb-thermo" title={`Started at ♩ = ${climb.start}; now ${climb.bpm}; target ${climb.target}`}>
                <span className="relative h-8 w-2 overflow-hidden rounded-full bg-gray-700">
                  <span
                    className={`absolute bottom-0 left-0 w-full transition-all ${climb.reached ? 'bg-emerald-400' : 'bg-amber-400'}`}
                    style={{ height: `${climbPercent(climb)}%` }}
                  />
                </span>
                <span className="flex flex-col leading-none">
                  <span className="text-[10px] text-gray-500">{climb.target}</span>
                  <span className="font-mono text-amber-200">{climb.bpm}</span>
                  <span className="text-[10px] text-gray-500">{climb.start}</span>
                </span>
              </span>
            )}
          </span>
      </>
    ),
    simple: (
      <>
        <button
          onClick={() => toggleSimple(piece.label)}
          aria-pressed={simplePieces.includes(piece.label)}
          title="Mark as simple: Sight-read picks from these first"
          data-testid="simple-mark"
          className={`${btn} ${simplePieces.includes(piece.label) ? 'ring-2 ring-emerald-400' : ''}`}
        >
          Simple
        </button>
      </>
    ),
    sightRead: (
      <>
        <button
          onClick={sightRead}
          disabled={status === 'loading'}
          title="A piece you don't know, one hand, 5-8 bars. What you're drilling now is kept."
          data-testid="sight-read"
          className={btn}
        >
          Sight-read
        </button>
      </>
    ),
    freshTune: (
      <>
        <button
          onClick={freshTune}
          disabled={status === 'loading'}
          title="A short folk tune you have never had, in this key. No hints until you miss."
          data-testid="fresh-tune"
          className={btn}
        >
          Fresh tune
        </button>
      </>
    ),
    freshKey: (
      <>
        <select
          value={freshKey}
          onChange={(e) => useSettingsStore.getState().setFreshKey(e.target.value)}
          title="The key for fresh tunes"
          data-testid="fresh-key"
          className="rounded-md border border-gray-700 bg-gray-900 px-1 py-1 text-sm text-gray-200"
        >
          {FRESH_KEYS.map((k) => (
            <option key={k.name} value={k.name}>
              {keyTitle(k.name)}
            </option>
          ))}
        </select>
      </>
    ),
    bare: (
      <>
        {bareNow ? (
          <button onClick={() => finishBare(true)} title="Stop now and see how it went" data-testid="bare-stop" className={`${btn} ring-2 ring-amber-400`}>
            No hints {Math.floor(bareLeft / 60000)}:{String(Math.floor(bareLeft / 1000) % 60).padStart(2, '0')} ■
          </button>
        ) : (
          <button
            onClick={startBareRun}
            disabled={status !== 'ready'}
            title="JP: end a session with five minutes on this piece without training wheels. No green keys, little staff or note names, even after a miss. Counts the bars you get through clean."
            data-testid="bare-start"
            className={btn}
          >
            5 min, no hints
          </button>
        )}
      </>
    ),
    openPiece: (
      <>
        {window.tutorBridge && (
          <button onClick={openPiece} className={btn}>
            Open piece…
          </button>
        )}
      </>
    ),
    trainingWheels: (
      <>
        {showKeyboard && (
          <label
            className="ml-2 flex items-center gap-1.5 text-sm text-gray-300"
            title="Show the keys to play only in the first bar of each lap; after that they fade, and come back if you pause or miss"
          >
            <input
              type="checkbox"
              data-testid="training-wheels"
              checked={trainingWheels}
              onChange={(e) => useSettingsStore.getState().setPrefs({ trainingWheels: e.target.checked })}
            />
            Training wheels
          </label>
        )}
      </>
    ),
    miniStaff: (
      <>
        {showKeyboard && (
          <label
            className="ml-2 flex items-center gap-1.5 text-sm text-gray-300"
            title="Show the notes to play now on a little staff just above the keyboard"
          >
            <input
              type="checkbox"
              data-testid="mini-staff-toggle"
              checked={miniStaff}
              onChange={(e) => useSettingsStore.getState().setPrefs({ miniStaff: e.target.checked })}
            />
            Mini staff
          </label>
        )}
      </>
    ),
    readAhead: (
      <>
        <label
          className="ml-2 flex items-center gap-1.5 text-sm text-gray-300"
          title="Experimental: the notes at the cursor blank out as it reaches them, so you have to read ahead. They come back after a wrong note. No key or note-name hints while it's on"
        >
          <input
            type="checkbox"
            data-testid="read-ahead"
            checked={readAhead}
            onChange={(e) => useSettingsStore.getState().setPrefs({ readAhead: e.target.checked })}
          />
          Read ahead <span className="text-amber-300/80 text-xs">(experimental)</span>
        </label>
      </>
    ),
    missSound: (
      <>
        <label
          className="ml-2 flex items-center gap-1.5 text-sm text-gray-300"
          title="A short sound the moment a lap stops being clean (a wrong note or a grazed key), so you know it won't count"
        >
          <input
            type="checkbox"
            data-testid="miss-sound"
            checked={missSound}
            onChange={(e) => useSettingsStore.getState().setPrefs({ missSound: e.target.checked })}
          />
          Miss sound
        </label>
        <button
          type="button"
          data-testid="miss-sound-test"
          data-stay
          className="ml-1 rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300 hover:bg-gray-700"
          title="Play the miss sound once, to hear how loud it is"
          onClick={() => void playMissSound(missVolume, missKind)}
        >
          Test
        </button>
        <select
          data-testid="miss-kind"
          aria-label="Miss sound"
          className="ml-1 rounded bg-gray-800 px-1 py-0.5 text-xs text-gray-300"
          title="Which sound: Click and Buzz are high and sharp so they cut through the piano; Knock is lower, for a speaker with no highs"
          value={missKind}
          onChange={(e) => {
            const kind = e.target.value as typeof missKind;
            useSettingsStore.getState().setPrefs({ missKind: kind });
            void playMissSound(missVolume, kind);
          }}
        >
          {MISS_KINDS.map((k) => (
            <option key={k} value={k}>{MISS_KIND_LABEL[k]}</option>
          ))}
        </select>
        <label className="ml-2 flex items-center gap-1.5 text-sm text-gray-300" title="How loud the miss sound is. Turn it up until you can hear it over your playing, then press Test. Past 100% it is boosted and softly clipped, so it gets louder without cracking">
          Miss volume
          <input
            type="range"
            min={0}
            max={MISS_VOLUME_MAX}
            step={5}
            value={missVolume}
            data-testid="miss-volume"
            aria-label="Miss volume"
            className="w-24"
            onChange={(e) => useSettingsStore.getState().setPrefs({ missVolume: Number(e.target.value) })}
          />
          <span className="w-8 text-xs text-gray-400" data-testid="miss-volume-value">{missVolume}%</span>
        </label>
      </>
    ),
    scoreWheelFingers: (
      <>
        <label
          className="ml-2 flex items-center gap-1.5 text-sm text-gray-300"
          title="On: the scroll wheel over a note on the score changes its finger. Off: the wheel there only scrolls"
        >
          <input
            type="checkbox"
            data-testid="score-wheel-fingers"
            checked={scoreWheelFingers}
            onChange={(e) => {
              useSettingsStore.getState().setPrefs({ scoreWheelFingers: e.target.checked });
              if (!e.target.checked && hoverKey === null) setHoverTarget(null);
            }}
          />
          Wheel fingers on score
        </label>
      </>
    ),
    keyWheelFingers: (
      <>
        <label
          className="ml-2 flex items-center gap-1.5 text-sm text-gray-300"
          title="On: the scroll wheel over a key on the keyboard changes that note's finger. Off: the wheel there only scrolls"
        >
          <input
            type="checkbox"
            data-testid="key-wheel-fingers"
            checked={keyWheelFingers}
            onChange={(e) => useSettingsStore.getState().setPrefs({ keyWheelFingers: e.target.checked })}
          />
          Wheel fingers on keyboard
        </label>
      </>
    ),
    everyBarNumbers: (
      <>
        {!strip && (
          <label className="ml-2 flex items-center gap-1.5 text-sm text-gray-300" title="On: a number over every bar. Off: only the bar that starts each line">
            <input
              type="checkbox"
              data-testid="every-bar-numbers"
              checked={everyBarNumbers}
              onChange={(e) => useSettingsStore.getState().setPrefs({ everyBarNumbers: e.target.checked })}
            />
            Number every bar
          </label>
        )}
      </>
    ),
    bigNotes: (
      <>
        {strip && (
          <label className="ml-2 flex items-center gap-1.5 text-sm text-gray-300" title="On: the music fills the panel (big notes). Off: the older, smaller fit">
            <input
              type="checkbox"
              data-testid="strip-fit-ink"
              checked={stripFitInk}
              onChange={(e) => useSettingsStore.getState().setPrefs({ stripFitInk: e.target.checked })}
            />
            Big notes
          </label>
        )}
      </>
    ),
    reverseWheel: (
      <>
        {strip && (
          <label className="ml-2 flex items-center gap-1.5 text-sm text-gray-300" title="Turn the wheel the other way to move along the score">
            <input type="checkbox" data-testid="reverse-wheel" checked={reverseWheel} onChange={(e) => setReverseWheel(e.target.checked)} />
            Reverse wheel
          </label>
        )}
        {strip && (
          <label className="ml-2 flex items-center gap-1.5 text-sm text-gray-300" title="Off: the wheel slides the music to look around and your place stays (Shift+wheel moves it). On: the wheel moves your place a note per notch.">
            <input type="checkbox" data-testid="wheel-steps" checked={wheelSteps} onChange={(e) => setWheelSteps(e.target.checked)} />
            Wheel moves my place
          </label>
        )}
      </>
    ),
    handZones: (
      <>
          <button
            onClick={() => setZonesOn((z) => !z)}
            disabled={status !== 'ready'}
            aria-pressed={zonesOn}
            className={`${btn} ${zonesOn ? 'ring-2 ring-sky-400' : ''}`}
            title="JP: see which fingers move where. Each hand position is shaded on its staff; a red mark is a jump of 5+ keys with no rest before it, where you'd be fishing."
            data-testid="hand-zones"
          >
            Hand zones
          </button>
      </>
    ),
    chordMoves: (
      <>
          <button
            onClick={() => setChordsOn((c) => !c)}
            disabled={status !== 'ready'}
            aria-pressed={chordsOn}
            className={`${btn} ${chordsOn ? 'ring-2 ring-violet-400' : ''}`}
            title="JP: who moves, who stays? From each chord to the next in the same hand: blue = the key stays, amber = it moves (+2 = two keys up). 'same move' = the change repeats; 'all +5' = the whole hand shifts."
            data-testid="chord-moves"
          >
            Chord moves
          </button>
      </>
    ),
  };
  // A running 5-minute run keeps its Stop button on the front row, whatever the corral says.
  const shown = (id: ControlId) => corral.front.has(id) || (id === 'bare' && !!bareNow);
  const wrapped = (id: ControlId) => <span key={id} data-ctl={id} className="contents">{controls[id]}</span>;
  const slot = (id: ControlId) => (shown(id) ? wrapped(id) : null);
  const hidden = ORDER.filter((id) => !shown(id));
  const hiddenOn = hiddenOnCount(ORDER.filter(shown), ORDER, controlOn);
  const noteUse = (e: { target: EventTarget }) => {
    const id = (e.target as HTMLElement).closest?.('[data-ctl]')?.getAttribute('data-ctl');
    // After the event, never during it: a re-render in the capture phase resets a controlled box to its old value.
    if (id) setTimeout(() => corral.use(id), 0);
  };

  return (
    // Strip (#5153): exactly the screen's height; the music slides sideways, never the page.
    <div className={`flex w-full flex-col gap-3 ${strip ? 'h-full min-h-0' : ''}`}>
      <TaskPanel />
      {/* Sticky so Restart / loop / piece stay on screen in full screen and when the
          cursor scrolls the score (#9480). */}
      <div
        onClickCapture={noteUse}
        onChangeCapture={(e) => { if ((e.target as HTMLInputElement).type !== 'checkbox') noteUse(e); }}
        data-score-toolbar
        className="sticky top-0 z-20 -mx-2 flex flex-col gap-2 rounded-b-md bg-gray-950/95 px-2 py-2 backdrop-blur">
        {looking && (
          <span data-testid="looking" className="pointer-events-none absolute right-2 top-full mt-1 rounded bg-sky-700 px-2 py-0.5 text-xs text-white">
            Looking — play or Esc to go back
          </span>
        )}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={pieceId}
          onChange={(e) => setPieceId(e.target.value)}
          className="rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm text-gray-200"
        >
          {favoritePieces.length > 0 && (
            <optgroup label="★ Favorites">
              {favoritePieces.map((p) => (
                <option key={p.id} value={p.id}>
                  {`${trustMark(p.trust)} ${p.label}`}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label={favoritesOnly && favoritePieces.length ? 'On screen' : 'All pieces'}>
            {listedOthers.map((p) => (
              <option key={p.id} value={p.id}>
                {`${trustMark(p.trust)} ${p.label}`}
              </option>
            ))}
          </optgroup>
        </select>
        <button
          onClick={() => toggleFavorite(piece.label)}
          aria-pressed={favorites.includes(piece.label)}
          title={favorites.includes(piece.label) ? 'Remove from favorites' : 'Add to favorites (keeps it at the top)'}
          className={`rounded-md bg-gray-800 px-2 py-1 text-sm hover:bg-gray-700 ${
            favorites.includes(piece.label) ? 'text-yellow-400' : 'text-gray-400'
          }`}
        >
          {favorites.includes(piece.label) ? '★' : '☆'}
        </button>
        <button
          onClick={() => setFavoritesOnly(!favoritesOnly)}
          disabled={favoritePieces.length === 0}
          aria-pressed={favoritesOnly}
          title="List only your favorites"
          data-testid="favorites-only"
          className={`${btn} ${favoritesOnly && favoritePieces.length ? 'ring-2 ring-yellow-400' : ''}`}
        >
          ★ only
        </button>
        {bareMsg && (
          <span data-testid="bare-msg" className="text-xs text-amber-300">
            {bareMsg}
          </span>
        )}
        {backTo && backTo.id !== piece.id && (
          <button onClick={() => setPieceId(backTo.id)} data-testid="sight-back" className={btn}>
            Back to {backTo.label}
          </button>
        )}
        {sightMsg && (
          <span data-testid="sight-msg" className="text-xs text-sky-300">
            {sightMsg}
          </span>
        )}
        {/* Easy / Harder / My mix of the same song (#9627); his choice is remembered per song. */}
        {versions.length > 1 && (
          <div role="group" aria-label="Version" className="flex overflow-hidden rounded-md border border-gray-700 text-sm">
            {versions.map((v) => (
              <button
                key={v.id}
                data-version={v.group.label}
                aria-pressed={v.id === piece.id}
                onClick={() => {
                  setPieceId(v.id);
                  setPieceVersion(v.group.slug, v.id.slice('file:'.length));
                }}
                className={`px-2 py-1 ${
                  v.id === piece.id ? 'bg-sky-600 text-white' : 'bg-gray-900 text-gray-300 hover:bg-gray-800'
                }`}
              >
                {v.group.label}
              </button>
            ))}
          </div>
        )}
        {mixPlan && easyPiece && harderPiece && window.tutorBridge?.saveMix && (
          <button onClick={() => setMixing(true)} className={btn}>
            {hasMix ? 'Edit my mix' : 'Make my mix'}
          </button>
        )}
        {/* trust.json "no_mix" (#9794): say why, visibly, instead of just dropping the button. */}
        {piece.group?.mixBlocked && (
          <>
            <button disabled data-mix-blocked className={`${btn} cursor-not-allowed opacity-50`}>
              {hasMix ? 'Edit my mix' : 'Make my mix'}
            </button>
            <span className="text-xs text-amber-400">{piece.group.mixBlocked}</span>
          </>
        )}
        {/* Visible, not hover-only: what the OMR audit knows about this score (#9644). */}
        <span
          data-testid="trust-badge"
          title={piece.group?.label === 'My mix' ? undefined : trustTitle(piece.trust)}
          className={`text-xs ${
            piece.trust?.status === 'issues'
              ? 'text-amber-400'
              : piece.trust?.status === 'checked'
                ? 'text-emerald-400'
                : 'text-gray-400'
          }`}
        >
          {piece.group?.label === 'My mix'
            ? `My mix: ${piece.trust?.note || 'from checked versions'}`
            : trustBadge(piece.trust)}
        </span>
        {scanSlug && (
          <button
            onClick={() => void printForBinder()}
            disabled={status !== 'ready' || printing}
            className={btn}
            data-testid="print-binder"
            title="Each page on both sides of its own sheet, so every turn shows two pages; every bar numbered. Shows a preview first; warns if the score isn't verified in Review."
          >
            {printing ? 'Printing…' : 'Print for binder'}
          </button>
        )}
        {printNote && <span className="text-xs text-gray-300" data-testid="print-binder-note">{printNote}</span>}
        {binderPreview && (
          <BinderPreview data={binderPreview} busy={printing} onPrint={() => void confirmBinderPrint()} onSavePdf={() => void saveBinderPdf()} onCancel={cancelBinderPrint} />
        )}
        {mixing && mixPlan && easyPiece && harderPiece && (
          <MixBuilder
            title={piece.label}
            plan={mixPlan}
            easyXml={easyPiece.xml}
            harderXml={harderPiece.xml}
            easyTrust={easyPiece.trust}
            harderTrust={harderPiece.trust}
            onSave={saveMix}
            onClose={() => setMixing(false)}
          />
        )}
        {piece.photo && (
          <div className="flex overflow-hidden rounded-md border border-gray-700 text-sm" role="group" aria-label="Photo or score">
            {(['score', 'photo'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                disabled={v === 'score' && !piece.xml}
                aria-pressed={view === v}
                className={`px-3 py-1 font-medium capitalize disabled:opacity-40 ${
                  view === v ? 'bg-gray-700 text-white' : 'bg-gray-900 text-gray-400 hover:text-gray-200'
                }`}
              >
                {v === 'score' ? 'Score' : 'Photo'}
              </button>
            ))}
          </div>
        )}
        {slot('layout')}
        {scanLayout && (
          <button
            data-testid="original-toggle"
            onClick={() => setShowOriginal((v) => !v)}
            title="Show the scanned page for the bar you are on"
            className={`${btn} ${showOriginal ? 'ring-2 ring-indigo-400' : ''}`}
          >
            Original
          </button>
        )}
        {slot('hand')}
        {slot('follow')}
        {slot('keyboard')}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {slot('missSound')}
          {ORDER.filter((id) => PLACEMENT[id] === 'more' && shown(id)).map(slot)}
          <Popover label="More" badge={hiddenOn ? `${hiddenOn} on` : undefined} testId="menu-more" btn={btn} onOpenChange={corral.hold}>
            {hidden.map(wrapped)}
            {hidden.length === 0 ? <span className="text-xs text-gray-400">Everything is on the main row.</span> : (
              <button data-stay onClick={corral.showEverything} data-testid="show-everything" className={btn}>Show everything</button>
            )}
          </Popover>
          <PracticeReport btn={btn} piece={pieceName} onLoopBar={(bar) => applyLoop({ first: bar, last: bar })} onAddSpot={addSpotAt} onBlockBar={(bar) => {
            applyLoop({ first: bar, last: bar });
            startBlock({ first: bar, last: bar });
          }} disabled={watching || keeping || status !== 'ready'} />
          <PracticeSettings btn={btn} />
          {slot('loopBars')}
          {chords && (
            <span data-testid="chords-msg" className="text-xs text-violet-300">
              {chords.changes} chord change{chords.changes === 1 ? '' : 's'}
              {chords.changes > 0 && `, ${chords.kept} keep a note, ${chords.same} repeat the last move`}
            </span>
          )}
          {zones && (
            <span data-testid="zones-msg" className="text-xs text-sky-300">
              Right {zones.right} position{zones.right === 1 ? '' : 's'}, left {zones.left};{' '}
              {zones.shifts.length ? `${zones.shifts.length} jump${zones.shifts.length === 1 ? '' : 's'} to plan` : 'no jumps'}
            </span>
          )}
          {/* While it plays for him, the timer owns the cursor. */}
          {slot('prev')}
          {slot('next')}
          {slot('watch')}
          {slot('keepGoing')}
          {keep && (
            <span className="text-sm text-amber-200" data-testid="keep-status">
              {keep.count > 0 ? `Count-in… ${keep.count}` : `Lap ${keep.lap} at ♩ = ${keep.bpm}: ${keep.hit} right, ${keep.wrong} wrong`}
            </span>
          )}
          {keepLast && (
            <span className="text-sm text-gray-300" data-testid="keep-last">
              {keepLast}
            </span>
          )}
          <button
            onClick={restartByHand}
            disabled={status !== 'ready'}
            className="rounded-md bg-indigo-600 px-3 py-1 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            Restart
          </button>
        </div>
      </div>

      {showOriginal && scanLayout && scanSlug && status === 'ready' && (
        <OriginalScan slug={scanSlug} layout={scanLayout} bar={measure} />
      )}
      {status === 'ready' && block && blockTipOpen && (
        <div className="rounded-md border border-yellow-500/60 bg-yellow-950/40 px-3 py-2 text-sm text-yellow-100" data-testid="block-tip">
          <div className="font-semibold text-yellow-300">How Block works</div>
          {blockHowTo(block.positions.length).map((line) => (
            <p key={line}>{line}</p>
          ))}
          <button onClick={closeBlockTip} className="mt-1 rounded bg-yellow-500 px-3 py-0.5 font-medium text-gray-950 hover:bg-yellow-400" data-testid="block-tip-got-it">
            Got it
          </button>
        </div>
      )}
      {status === 'ready' && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-md bg-gray-900/60 px-3 py-2 text-sm">
          <label className="flex items-center gap-1 text-gray-400">
            Bar
            <BarInput testId="bar-now" value={measure} last={lastBar} onCommit={jumpToBar} disabled={watching || keeping} title="Type a bar number to go there" />
          </label>
          {blockPos ? (
            // #5657c: the whole position, held together; hidden with the keys once he has it.
            <span className="text-gray-400" data-testid="next-notes">
              Press together:{' '}
              <span className="font-mono font-semibold text-indigo-300">{blockHints ? pressTogether(blockPos, noteName) : '…'}</span>
            </span>
          ) : (
            // #6369: a fixed width, so the range boxes after it never slide or wrap as the notes change.
            <span className="inline-block w-56 truncate align-bottom text-gray-400" data-testid="next-notes"
              title={playHint ? `${namesOf(remaining)} (${playHint})` : undefined}>
              Play:{' '}
              <span className="font-mono font-semibold text-indigo-300">
                {finished ? '—' : hintsOff && !hints ? '…' : remaining.length ? namesOf(remaining) : '—'}
              </span>
              {!finished && playHint && (!hintsOff || hints) && <span className="text-indigo-200/80"> ({playHint})</span>}
            </span>
          )}
          <span className="text-gray-400">
            Wrong notes: <span className="inline-block w-[3ch] font-mono text-gray-200">{wrongCount}</span>
          </span>
          {(overall || picking !== 'off') && (
            <span className="flex flex-wrap items-center gap-1 text-yellow-300" data-testid="loop-status">
              Selected
              <BarInput
                testId="loop-first"
                value={picking === 'off' ? overall?.first ?? null : pickStart}
                from={measure}
                last={lastBar}
                onCommit={typedFirst}
                onPreview={(bar) => setPreviewBars(bar === null || picking !== 'off' || !overall ? null : { first: Math.min(bar, overall.last), last: Math.max(bar, overall.last) })}
                disabled={watching || keeping}
                focus={picking === 'start'}
                title="First bar of the range"
              />
              –
              <BarInput
                testId="loop-last"
                value={picking === 'off' ? overall?.last ?? null : null}
                from={pickStart ?? measure}
                last={lastBar}
                onCommit={typedLast}
                onPreview={(bar) => {
                  const first = picking === 'off' ? overall?.first : pickStart;
                  setPreviewBars(bar === null || first == null ? null : { first: Math.min(first, bar), last: Math.max(first, bar) });
                }}
                disabled={watching || keeping}
                focus={picking === 'end'}
                title="Last bar of the range"
              />
              {picking === 'off' && overall && (
                <button
                  onClick={() => {
                    useSettingsStore.getState().toggleStar(pieceLabelRef.current, overall);
                    reportEvent('star', { firstBar: overall.first, lastBar: overall.last, on: !overallStarred });
                  }}
                  disabled={watching || keeping}
                  aria-pressed={overallStarred}
                  className={`px-1 text-lg leading-none ${overallStarred ? 'text-yellow-300' : 'text-gray-500 hover:text-yellow-200'}`}
                  title={overallStarred ? 'Unstar this range' : 'Star this range, to pick it again from Starred'}
                  aria-label={overallStarred ? 'Unstar this range' : 'Star this range'}
                  data-testid="star-range"
                >
                  {overallStarred ? '★' : '☆'}
                </button>
              )}
              {picking === 'off' && (
                // #6513: one list of his loops: starred ranges and trouble spots together, by bar.
                <Popover label={`Loops ${loopCount}`} testId="loops" btn={`${btn} px-1.5 py-0.5`} wide>
                  {/* #6582: the lesson plan, where he looks for loop tools. Same button rule as the toolbar one; starting it
                      keeps his selected loop (Stop puts it back exactly). */}
                  {loopBars && (
                    <button
                      onClick={lesson ? () => stopLesson('button') : startLesson}
                      disabled={watching || keeping || !!block || !!chunk || (!lesson && !lessonReady)}
                      className={`${btn} ${lesson ? 'bg-yellow-500 text-gray-950 hover:bg-yellow-400' : ''}`}
                      title={lesson ? 'Stop the lesson plan: back to your own loop'
                        : lessonReady ? 'Loops the rough spots of your last laps one by one until clean, then the whole loop'
                          : `Play the loop ${LESSON_MIN_LAPS} times first`}
                      data-testid="lesson-plan-menu"
                    >
                      {lesson ? 'Stop lesson plan' : lessonReady ? 'Lesson plan: work the rough spots of this loop' : `Lesson plan (play the loop ${LESSON_MIN_LAPS} times first)`}
                    </button>
                  )}
                  {lastMerge && (
                    <button
                      data-stay
                      onClick={() => {
                        const undone = useSettingsStore.getState().undoLastMerge(piece.label);
                        if (undone) reportEvent('spot', { unmerged: undone.to, restored: undone.from.length });
                      }}
                      className={btn}
                      data-testid="spot-unmerge"
                      title="Splits that one joined spot back into the separate spots it replaced. Your selected loop stays as it is."
                    >
                      ↶ Undo join: {spanText(lastMerge.to)} → back to {lastMerge.from.length} separate spot{lastMerge.from.length === 1 ? '' : 's'}
                    </button>
                  )}
                  {overall && overall.last - overall.first < MAX_SPOT_BARS && !spotList.some((sp) => !sp.ticked && sp.first === overall.first && sp.last === overall.last) && (
                    <button onClick={() => putSpot(overall)} disabled={watching || keeping} className={btn} data-testid="spot-add">
                      + Add {spanText(overall)} as a spot
                    </button>
                  )}
                  {loopRows.length === 0 && (
                    <span className="text-xs text-gray-400">
                      No loops yet. Star a range with ☆, and bars you keep missing or slowing down on get added here.
                    </span>
                  )}
                  {openSpots > 0 && (
                    <span className="text-xs leading-snug text-gray-400" data-testid="loops-legend">
                      <b className="text-gray-300">Alone</b>: you looped just that spot (the loop sits inside it) with no wrong notes.{' '}
                      <b className="text-gray-300">In context</b>: you played through it in a longer loop or the whole piece, with no wrong notes inside the spot (misses elsewhere don't count against it).
                      A spot comes off the list when both reach {spotClean}. Picking a row replaces your selected loop.
                    </span>
                  )}
                  {loopRows.map(({ first, last, star, spot }) => {
                    const id = `${first}-${last}`;
                    const done = !!spot?.ticked && !star;
                    return (
                      <span key={id} className="flex items-center gap-2" data-testid={spot ? `spot-${id}` : undefined}>
                        <span className={`w-4 text-center ${star ? 'text-yellow-300' : 'text-transparent'}`} aria-hidden>★</span>
                        {done ? (
                          <span className="flex-1 font-mono text-gray-500">{spotLabel(spot!, spotClean)}</span>
                        ) : (
                          <button
                            onClick={() => {
                              editRange({ first, last });
                              reportEvent(star ? 'star-pick' : 'spot-pick', { firstBar: first, lastBar: last });
                            }}
                            disabled={watching || keeping}
                            className={`${btn} flex-1 text-left font-mono`}
                            data-testid={star ? `starred-${id}` : `spot-loop-${id}`}
                            title={spot && !spot.ticked
                              ? `Loop these bars (replaces your selected loop). Alone ${Math.min(spot.alone, spotClean)}/${spotClean}: clean laps of just this spot. In context ${Math.min(spot.inContext, spotClean)}/${spotClean}: clean passes through it inside a longer loop or the whole piece.`
                              : 'Loop these bars (replaces your selected loop)'}
                          >
                            {spot && !spot.ticked ? spotLabel(spot, spotClean) : first === last ? `Bar ${first}` : `Bars ${first}–${last}`}
                          </button>
                        )}
                        {star && (
                          <button
                            data-stay
                            onClick={() => useSettingsStore.getState().toggleStar(pieceLabelRef.current, { first, last })}
                            className="px-1 text-gray-400 hover:text-red-300"
                            title="Remove this star"
                            aria-label={`Remove star ${first}–${last}`}
                            data-testid={`unstar-${id}`}
                          >
                            ☆✕
                          </button>
                        )}
                        {spot && !spot.ticked && (
                          <button
                            data-stay
                            onClick={() => {
                              useSettingsStore.getState().dismissSpot(pieceLabelRef.current, spot);
                              reportEvent('spot', { removed: { first, last } });
                            }}
                            className="px-1 text-gray-400 hover:text-red-300"
                            title="Take this spot off the list"
                            aria-label={`Remove spot ${first}–${last}`}
                            data-testid={`spot-x-${id}`}
                          >
                            ✕
                          </button>
                        )}
                      </span>
                    );
                  })}
                </Popover>
              )}
              {picking === 'off' && loopBars && (
                <>
                  {chunk && <span data-testid="loop-now">· now looping {loopBars.first}–{loopBars.last}</span>}
                  <span>· Lap <span className="font-mono" data-testid="loop-lap">{lap}</span></span>
                  {lapBpm && <span className="text-yellow-200/80">(last lap ♩ = {lapBpm})</span>}
                </>
              )}
            </span>
          )}
          {lesson && (
            <span className="flex items-center gap-2 font-semibold text-yellow-300" data-testid="lesson-status">
              {lessonLabel(lesson)}
              <button onClick={skipLesson} className="rounded px-2 py-0.5 text-yellow-200 hover:bg-yellow-800/40" data-testid="lesson-skip">
                Skip step
              </button>
            </span>
          )}
          {chunk && (
            <span className="font-semibold text-yellow-300" data-testid="backwards-status">
              {chunk.out ? outwardLabel(chunk) : chunkLabel(chunk)}
            </span>
          )}
          {keyGateNow && (
            <span className="flex items-center gap-1.5 font-semibold text-yellow-300" data-testid="key-first">
              Key first: {gateAsk(keyGateNow.fifths)}
              {gateShown(keyGateNow).map((n, i) => (
                <span key={i} className={`w-8 text-center rounded ${n === '?' ? 'bg-gray-700 text-gray-400' : 'bg-emerald-700 text-white'}`}>
                  {n}
                </span>
              ))}
            </span>
          )}
          {block && (
            <span className="font-semibold text-yellow-300" data-testid="block-status">
              {blockLabel(block)}
            </span>
          )}
          {block && !block.done && block.spoiled && (
            <span className="font-semibold text-red-300" data-testid="block-wrong">
              {BLOCK_WRONG_NOTE}
            </span>
          )}
          {/* His live tempo, big enough to read from the bench (#8979). */}
          <span className="text-gray-400" data-testid="tempo">
            <span className="font-mono text-2xl font-bold text-white">♩ = {pace ?? '—'}</span>
            {markedBpm && <span className="text-gray-500"> ({piece.targetBpm ? "target" : "marked"} {markedBpm})</span>}
          </span>
          <span className="min-w-[14rem] font-medium" data-testid="feedback">
            {feedback.kind === 'wrong' && (
              <span className="text-red-400">
                ✗ {noteName(feedback.played)} — play {namesOf(feedback.remaining)}
                {feedback.remaining.length > 1 && ' together'}
                {feedback.remaining.length < feedback.expected.length &&
                  ` (${namesOf(feedback.expected.filter((m) => !feedback.remaining.includes(m)))} held)`}
                {feedback.hint && ` · ${feedback.hint}`}
              </span>
            )}
            {feedback.kind === 'complete' && (
              <span className="text-green-400">
                ✓ Piece complete{wrongCount === 0 ? ' — no wrong notes!' : ` — ${wrongCount} wrong`}
              </span>
            )}
          </span>
          {fingerMsg && (
            <span className="text-purple-300" data-testid="finger-msg">
              {fingerMsg}
            </span>
          )}
          {spreadFrom && spreadPlan?.ok && spreadPlan.applicable > 0 && (
            <button
              onClick={spreadAll}
              className="rounded bg-purple-700 px-2 py-0.5 text-sm font-medium text-white hover:bg-purple-600"
              title="Give every other spot with exactly these notes (same hand, same octave) this spot's fingering. A note you already fingered differently is left alone."
              data-testid="spread-fingering"
            >
              Same fingering on {spreadPlan.applicable} more{spreadPlan.skipped ? ` (keeps ${spreadPlan.skipped} you fingered differently)` : ''}
            </button>
          )}
          {pedalTip && (
            <span className="font-medium text-amber-300" data-testid="pedal-tip">
              {pedalTip}
            </span>
          )}
        </div>
      )}
      </div>

      {reached && (
        <div
          className="flex items-center justify-between gap-4 rounded-lg border-2 border-green-500 bg-green-900/40 px-5 py-4"
          data-testid="target-reached"
          role="status"
        >
          <span className="text-xl font-semibold text-green-200">✓ {reached}</span>
          {/* Focused so the trackball click or Enter both go again (#5382). */}
          <button
            autoFocus
            onClick={restartByHand}
            className="rounded-md bg-green-600 px-5 py-2 text-lg font-semibold text-white hover:bg-green-500"
            data-testid="target-reached-restart"
          >
            Go again
          </button>
        </div>
      )}
      {advice && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-700/60 bg-amber-900/20 px-3 py-2 text-sm text-amber-100" data-testid="advice" data-rule={advice.rule}>
          <span className="flex-1">
            {advice.text}
            {advice.sub && <span className="block text-amber-200/80">{advice.sub}</span>}
          </span>
          {advice.action && (
            <button
              onClick={actOnAdvice}
              className="rounded bg-amber-600 px-3 py-1 font-semibold text-white hover:bg-amber-500"
              data-testid={`advice-${advice.action.kind}`}
            >
              {actionLabel(advice.action)}
            </button>
          )}
          <button onClick={() => closeAdvice('not-today')} className="rounded px-2 py-1 text-amber-200 hover:bg-amber-800/40" data-testid="advice-not-today">
            Not today
          </button>
          <button onClick={() => closeAdvice('close')} className="rounded px-2 py-1 text-amber-200 hover:bg-amber-800/40" aria-label="Close" data-testid="advice-close">
            ×
          </button>
        </div>
      )}
      {spotTip && (
        <p className="text-sm font-medium text-emerald-300" data-testid="spot-tip">
          {spotTip}
        </p>
      )}
      {grewTip && !reached && (
        <p className="text-sm font-medium text-yellow-200" data-testid="grew-tip">
          {grewTip}
        </p>
      )}

      {status === 'error' && (
        <p className="rounded-md border border-red-800/50 bg-red-900/20 p-3 text-sm text-red-300">
          Failed to render score: {errorMsg}
        </p>
      )}
      {status === 'loading' && <p className="text-sm text-gray-500">Loading score…</p>}
      {openError && (
        <p className="rounded-md border border-red-800/50 bg-red-900/20 p-3 text-sm text-red-300">
          Could not open that file: {openError}
        </p>
      )}
      {status === 'photo' && !piece.photo && (
        <p className="text-sm text-gray-500">This piece has no score or photo.</p>
      )}
      {status === 'photo' && piece.photo && (
        <p className="text-sm text-gray-400">Photo only: the notes could not be read from it.</p>
      )}

      {/* OSMD draws black notation, so give it a light panel. Blue heads = what he played
          right; red heads = a wrong note; red accidental = wrong sharp/flat/natural;
          yellow = the loop range. */}
      {/* Strip: the panel is the sideways scroller; a spacer after the music lets the last beat sit at the
          anchor too (none before it: the piece starts at the left edge). */}
      <div
        ref={panelRef}
        data-testid="score-panel"
        onClick={onScoreClick}
        className={`overflow-x-auto rounded-lg bg-white p-4 ring-4 transition-shadow ${
          wrongFlash ? 'ring-red-500' : 'ring-transparent'
        } ${picking !== 'off' ? 'cursor-pointer' : ''} ${strip ? `flex min-h-0 flex-1 ${stripFitInk ? 'overflow-y-hidden' : 'overflow-y-auto'}` : ''}`}
        style={strip ? { alignItems: 'safe center' } : undefined}
      >
        {showPhoto && piece.photo && (
          <img src={piece.photo} alt={`Photo of ${piece.label}`} className="mx-auto max-h-[70vh] w-auto max-w-full" />
        )}
        <div ref={layerRef} className={showPhoto ? 'hidden' : strip ? 'relative shrink-0' : 'relative'}>
          {/* OSMD makes each page as wide as this container, so it is half the panel and
              the second column of pages overflows into the other half on purpose. */}
          <div
            ref={containerRef}
            onClick={onScoreTap}
            onMouseOver={onScoreHover}
            onMouseLeave={() => setHoverTarget(null)}
            className={scoreLayout === 'pages' ? 'score-pages' : undefined}
            style={scoreLayout === 'pages' ? {
              width: 'calc((100% - 1.5rem) / 2)',
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 100%)',
              columnGap: '1.5rem',
              rowGap: SPREAD_BAR_PX,
              paddingTop: SPREAD_BAR_PX,
              alignItems: 'start',
            } : undefined}
          />
          {scoreLayout === 'pages' && spreadView && !showPhoto && (() => {
            const last = Math.ceil(spreadView.pages / 2) - 1;
            const lo = spreadView.at * 2 + 1;
            const hi = Math.min(spreadView.pages, lo + 1);
            const edge = 'absolute z-10 flex w-7 items-center justify-center text-2xl text-gray-300 hover:bg-sky-100/60 hover:text-sky-700 disabled:invisible';
            const turn = (way: number) => (e: React.MouseEvent) => {
              e.stopPropagation();
              turnSpread(way);
            };
            return (
              <>
                <div
                  data-testid="page-spread"
                  className="absolute left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-md bg-gray-100 px-2 text-sm text-gray-700"
                  style={{ top: spreadView.top - SPREAD_BAR_PX + 6 }}
                >
                  <button data-testid="page-prev" disabled={spreadView.at === 0} onClick={turn(-1)} className="px-1 disabled:opacity-30" title="Turn back (Page Up)">‹</button>
                  <span title="P flips back; scroll, Page Up / Page Down or click a page's outer edge to turn">
                    {lo === hi ? `Page ${lo}` : `Pages ${lo}-${hi}`} of {spreadView.pages}
                  </span>
                  {loopBars && (() => {
                    // #6585: a loop that runs past this spread is not silently cut off.
                    const end = spreadOfBar(loopBars.last);
                    return end !== null && end > spreadView.at ? (
                      <span className="text-sky-700" data-testid="page-loop-note">
                        · loop bars {loopBars.first}–{loopBars.last} goes on to page {end * 2 + 1}
                      </span>
                    ) : null;
                  })()}
                  <button data-testid="page-next" disabled={spreadView.at === last} onClick={turn(1)} className="px-1 disabled:opacity-30" title="Turn forward (Page Down)">›</button>
                </div>
                <button data-testid="page-edge-back" aria-label="Turn back" disabled={spreadView.at === 0} onClick={turn(-1)}
                  className={`${edge} left-0`} style={{ top: spreadView.top, height: spreadView.height }}>‹</button>
                <button data-testid="page-edge-forward" aria-label="Turn forward" disabled={spreadView.at === last} onClick={turn(1)}
                  className={`${edge} right-0`} style={{ top: spreadView.top, height: spreadView.height }}>›</button>
              </>
            );
          })()}
          {zones && <ZoneOverlay bands={zones.bands} marks={zones.marks} />}
          {blockBands && <ZoneOverlay bands={blockBands} marks={[]} prefix="block" tint="#facc15" />}
          {chords && <ChordOverlay rings={chords.rings} tags={chords.tags} />}
          <PlayedOverlay marks={marks} bands={bands} />
          {wave && <WaveOverlay key={wave.key} dots={wave.dots} peak={wave.peak} />}
        </div>
        {strip && !showPhoto && <div className="shrink-0" style={{ flexBasis: `${(1 - STRIP_ANCHOR) * 100}%` }} />}
      </div>
      {fingerPick && (
        <div
          className="fixed z-50 flex items-center gap-1 rounded-md border border-gray-700 bg-gray-900 p-1 shadow-lg"
          // A key on the strip is at the screen's edge: keep the picker on screen.
          style={{ left: Math.min(fingerPick.x + 8, window.innerWidth - 460), top: Math.min(fingerPick.y + 8, window.innerHeight - 60) }}
          data-testid="finger-picker"
        >
          <span className="px-1 text-xs text-gray-400" data-testid="finger-pick-name">
            {fingerPick.name}
            {fingerPick.alts?.length ? ` (${fingerPick.target.staff === 1 ? 'right' : 'left'} hand)` : ''}: finger
          </span>
          {fingerPick.alts?.length ? (
            <button
              onClick={() => {
                const [next, ...rest] = fingerPick.alts ?? [];
                if (next) openPick(fingerPick.x, fingerPick.y, next, [...rest, fingerPick.target]);
              }}
              className="rounded bg-gray-700 px-2 py-1 text-sm text-gray-200"
              data-testid="finger-other-hand"
            >
              Other hand
            </button>
          ) : null}
          {(['1', '2', '3', '4', '5'] as const).map((d) => (
            <button key={d} onClick={() => applyFinger(d)} className="rounded bg-purple-700 px-2 py-1 text-sm font-bold text-white hover:bg-purple-600">
              {d}
            </button>
          ))}
          <button onClick={() => applyFinger(null)} title="Remove its finger number" className="rounded bg-gray-700 px-2 py-1 text-sm text-gray-200">×</button>
          <button
            onClick={() => applyHold(!fingerPick.held)}
            title={fingerPick.held ? 'Play this note again here' : 'Keep it sounding from before (pedal or held key) instead of playing it again'}
            className="rounded bg-sky-800 px-2 py-1 text-sm text-white hover:bg-sky-700"
            data-testid="hold-toggle"
          >
            {fingerPick.held ? 'Re-strike' : "Hold (don't re-strike)"}
          </button>
          <button onClick={() => setFingerPick(null)} className="rounded px-2 py-1 text-sm text-gray-400">Cancel</button>
        </div>
      )}
      {/* Over the score at the pointer, so it can't push the music out from under it. */}
      {edgeTip && (
        <div
          className="pointer-events-none fixed z-50 rounded bg-sky-900/90 px-2 py-0.5 text-sm text-sky-100 shadow"
          style={{ left: Math.min(edgeTip.x + 12, window.innerWidth - 320), top: Math.max(4, edgeTip.y - 30) }}
          data-testid="loop-edge-tip"
        >
          End of your loop: scroll again to go past
        </div>
      )}
      {wheelLive && (
        <div
          className="pointer-events-none fixed z-50 rounded bg-yellow-300 px-2 text-lg font-bold text-gray-900 shadow"
          style={{ left: wheelLive.x + 12, top: wheelLive.y - 28 }}
          data-testid="finger-live"
        >
          {wheelLive.digit ?? '–'}
        </div>
      )}
      {/* Opaque, so nothing of the score shows through it (#5153). The strip puts it under
          the music edge to edge instead of over it. */}
      {showKeyboard && (
        <div
          ref={keyStripRef}
          className={strip ? 'relative -mx-6 -mb-6 shrink-0 bg-gray-950 px-1 py-1' : 'sticky bottom-0 z-20 -mx-2 rounded-t-md bg-gray-950 px-2 py-1'}
          data-testid="keyboard-strip"
        >
          {/* #11089: the mini staff gets its own band, so it never covers the music. */}
          {miniStaff && (
            <div className="relative -mx-1 bg-white" style={{ height: MINI_STAFF_BAND_PX }} data-testid="mini-staff-band">
              {mini?.map((p) => <MiniStaff key={p.hand} part={p} fifths={fifths} pct={p.pct} align={p.align} />)}
            </div>
          )}
          <PianoKeyboard88
            heightRatio={20}
            green={new Set(watching ? watchNotes : blockPos ? (blockHints ? blockPos.keys : []) : hints ? stepKeys : [])}
            red={blockPos ? new Set([...held].filter((k) => !blockPos.keys.includes(k))) : wrongKeys}
            held={held}
            tied={hints && !blockPos ? tiedKeys : undefined}
            tiedLabels={hints && !blockPos ? tiedLabels : undefined}
            leftHand={leftKeys}
            fadeMs={(blockPos ? blockHints : hints) ? undefined : 500}
            labels={blockPos ? blockLabels : hints ? keyLabels : undefined}
            yellow={wheelTarget && hoverKey === wheelTarget.midi ? hoverKey : null}
            onKeyHover={setHoverKey}
            onKeyClick={onKeyClick}
          />
        </div>
      )}
    </div>
  );
}
