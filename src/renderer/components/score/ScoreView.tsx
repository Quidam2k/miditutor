import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
// eslint-disable-next-line import/no-unresolved -- Vite ?raw import, not resolvable by eslint-plugin-import
import sampleXml from '../../assets/sample-score.musicxml?raw';
// eslint-disable-next-line import/no-unresolved -- Vite ?raw import, not resolvable by eslint-plugin-import
import minuetXml from '../../assets/minuet-in-g.musicxml?raw';
// eslint-disable-next-line import/no-unresolved -- Vite ?raw import, not resolvable by eslint-plugin-import
import aMinorXml from '../../assets/a-minor-scale.musicxml?raw';
// eslint-disable-next-line import/no-unresolved -- Vite ?raw import, not resolvable by eslint-plugin-import
import expressionXml from '../../assets/expression-test.musicxml?raw';
import { initAudio, playChord } from '../../audio/AudioEngine';
import { PianoKeyboard88 } from '../homework/PianoKeyboard88';
import { useMidiStore } from '../../store/useMidiStore';
import { ScoreFollower, ScoreStep } from '../../engine/ScoreFollower';
import { ExpressionTracker, describeMark, parseExpression, type ExpressionFinding } from '../../engine/Expression';
import { useTutorStore } from '../../store/useTutorStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { PieceTrust, trustBadge, trustMark } from '../../../shared/trust';
import type { MixChoice } from '../../../shared/mix';
import type { PieceGroupRef } from '../../../shared/versions';
import { reportEvent, reportScreen } from '../tutor/useTutorBridge';
import { TaskPanel } from '../tutor/TaskPanel';
import { Band, PlayedOverlay, PlayedMark } from './PlayedOverlay';
import { MixBuilder } from './MixBuilder';
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
  Length?: { RealValue: number };
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
  getSVGGElement?: () => SVGGElement | undefined;
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
  FingeringEntries?: { SVGNode?: Node }[];
  graphicalChordContainers?: { GetChordSymbolContainer: unknown; GraphicalLabel?: { SVGNode?: Node } }[];
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

// First key signature in the file. Mid-piece key changes are not tracked (v1).
const fifthsOf = (xml: string) => Number(/<fifths>\s*(-?\d+)\s*<\/fifths>/.exec(xml)?.[1] ?? 0);

// OSMD's halfTone is 0 at C0 in its own octave scheme; MIDI = halfTone + 12 (C4 = 60).
const toMidi = (n: OsmdNote) => n.halfTone + 12;

// A note must be struck at this position unless it is a rest, a grace note, or the
// continuation of a tie (the key is already held down from an earlier position).
const isStruck = (n: OsmdNote) =>
  !n.isRest() && !n.IsGraceNote && !(n.NoteTie && n.NoteTie.StartNote !== n);

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
function extractSteps(osmd: OpenSheetMusicDisplay, hand: 'both' | 'right' | 'left'): {
  steps: ScoreStep[];
  notes: OsmdNote[][];
  ringing: OsmdNote[][];
  chords: (StepChord | null)[];
} {
  const steps: ScoreStep[] = [];
  const notes: OsmdNote[][] = [];
  const ringing: OsmdNote[][] = [];
  const chords: (StepChord | null)[] = [];
  let chord: StepChord | null = null;
  let active: { note: OsmdNote; end: number }[] = [];
  const selectedStaff = hand === 'both' || osmd.Sheet.Staves.length < 2 ? null : hand === 'right' ? 0 : 1;
  const cursor = osmd.cursor;
  cursor.reset();
  for (let guard = 0; guard < 20000 && !cursor.iterator.EndReached; guard++) {
    const all = cursor.NotesUnderCursor() as unknown as OsmdNote[];
    const struck = all.filter(isStruck);
    const under = struck.filter((n) => selectedStaff === null || staffOf(n) === selectedStaff);
    const other = struck.filter((n) => selectedStaff !== null && staffOf(n) !== selectedStaff);
    const beat = cursor.iterator.currentTimeStamp.RealValue * 4;
    active = active.filter((a) => a.end > beat + 1e-6);
    // The other hand is optional, so playing its written notes is not wrong.
    const ring = [...active.map((a) => a.note), ...all.filter((n) => !n.isRest() && !isStruck(n)), ...other];
    steps.push({
      notes: under.map(toMidi),
      beat,
      measure: cursor.iterator.CurrentMeasureIndex + 1,
      ringing: [...new Set(ring.map(toMidi))],
    });
    notes.push(under);
    ringing.push(ring);
    const entries = cursor.iterator.CurrentVoiceEntries as unknown as OsmdVoiceEntry[];
    for (const c of entries.flatMap((ve) => ve.ParentSourceStaffEntry?.ChordContainers ?? [])) {
      const sym = c.RootPitch && chordSymbol(pcOf(c.RootPitch), c.ChordKind, c.BassPitch && pcOf(c.BassPitch));
      // A kind we can't spell (Neapolitan, 11ths) still ends the previous chord's span.
      chord = sym ? { ...sym, container: c } : null;
    }
    chords.push(chord);
    for (const n of all) {
      if (!n.isRest() && n.Length) active.push({ note: n, end: beat + n.Length.RealValue * 4 });
    }
    cursor.next();
  }
  cursor.reset();
  return { steps, notes, ringing, chords };
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

// Pages side by side (#5137): each page is half the panel wide and as tall as the screen
// allows, not A4, so two pages fill a TV instead of two small portrait sheets.
// Zoom keeps about a printed page's worth of music on each.
function fitPages(osmd: OpenSheetMusicDisplay, container: HTMLElement) {
  const w = container.offsetWidth;
  if (!w) return; // hidden behind the photo view: keep the last page size
  osmd.setCustomPageFormat(w, Math.max(400, window.innerHeight - PAGE_RESERVE_PX));
  osmd.Zoom = Math.max(0.5, Math.min(1, w / 1100));
}

// OSMD positions are relative to the bar's own page.
function pageSvgOf(osmd: OpenSheetMusicDisplay, container: HTMLElement, measureIdx0: number) {
  const staves = osmd.GraphicSheet.MeasureList[measureIdx0] as unknown as (OsmdMeasure | undefined)[] | undefined;
  const page = staves?.find((m) => m !== undefined)?.ParentMusicSystem?.Parent?.PageNumber;
  return (page ? container.querySelector<SVGSVGElement>('#osmdCanvasPage' + page + ' svg') : null)
    ?? container.querySelector('svg');
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

type Feedback =
  | { kind: 'idle' }
  | { kind: 'wrong'; played: number; expected: number[]; remaining: number[]; hint: string }
  | { kind: 'complete' };

export function ScoreView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const followerRef = useRef<ScoreFollower | null>(null);
  const stepNotesRef = useRef<OsmdNote[][]>([]);
  const ringNotesRef = useRef<OsmdNote[][]>([]);
  const stepChordsRef = useRef<(StepChord | null)[]>([]);
  // The chord symbol in force where he is playing, the keys struck under it, and
  // whether they now cover it (then the symbol is green).
  const chordLitRef = useRef(noChord());
  const lapStartRef = useRef<number | null>(null);
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
  const markIdRef = useRef(0);
  const [marks, setMarks] = useState<PlayedMark[]>([]);

  const [pieceId, setPieceId] = useState(PIECES[0].id);
  // 'photo': a pushed piece with no readable score yet, only its photo to show.
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'photo'>('loading');
  const [view, setView] = useState<'score' | 'photo'>('score');
  const [hand, setHand] = useState<'both' | 'right' | 'left'>('both');
  const handRef = useRef(hand);
  const [staffCount, setStaffCount] = useState(0);
  const [openError, setOpenError] = useState('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [following, setFollowing] = useState(true);
  const [watching, setWatching] = useState(false);
  const [watchNotes, setWatchNotes] = useState<number[]>([]);
  const held = useMidiStore((s) => s.held);
  const showKeyboard = useSettingsStore((s) => s.showKeyboard);
  const setShowKeyboard = useSettingsStore((s) => s.setShowKeyboard);
  const [remaining, setRemaining] = useState<number[]>([]);
  const [playHint, setPlayHint] = useState('');
  // Every key of the step stays lit on the strip, credited or not (#9993).
  const [stepKeys, setStepKeys] = useState<number[]>([]);
  const [measure, setMeasure] = useState(1);
  const [feedback, setFeedback] = useState<Feedback>({ kind: 'idle' });
  const [wrongCount, setWrongCount] = useState(0);
  const [pace, setPace] = useState<number | null>(null);
  const [wrongFlash, setWrongFlash] = useState(false);
  // Loop range (#5004): 'start'/'end' while he is clicking bars to set it.
  const [picking, setPicking] = useState<'off' | 'start' | 'end'>('off');
  const [pickStart, setPickStart] = useState<number | null>(null);
  const [loopBars, setLoopBars] = useState<{ first: number; last: number } | null>(null);
  const [lap, setLap] = useState(1);
  const [lapBpm, setLapBpm] = useState<number | null>(null);
  const [bands, setBands] = useState<Band[]>([]);
  const [layoutTick, setLayoutTick] = useState(0);
  const loopRequest = useTutorStore((s) => s.loopRequest);
  const scoreLayout = useSettingsStore((s) => s.scoreLayout);
  const setScoreLayout = useSettingsStore((s) => s.setScoreLayout);

  // Built-in pieces, his Pieces folder on disk, then anything pushed this session.
  // The folder is re-read when the window regains focus, so a synced file shows up.
  const [folder, setFolder] = useState<Piece[]>([]);
  // Re-read the folder now (after a mix is saved), whatever it looked like before.
  const reloadFolderRef = useRef<(() => Promise<void>) | undefined>(undefined);
  useEffect(() => {
    const list = window.tutorBridge?.listPieces;
    if (!list) return;
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
        .catch((err) => console.warn('[pieces] list failed:', err));
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
  useEffect(() => {
    if (selectPieceId) setPieceId(selectPieceId);
  }, [selectPieceId]);
  const piece = onScreen ?? PIECES[0];
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
  const fifths = useMemo(() => fifthsOf(piece.xml), [piece.xml]);

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
      measure,
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
      pickingLoop: picking === 'off' ? null : picking,
      playedMarks: marks.length,
      wrongMarks: marks.filter((m) => m.wrong).length,
      redAccidentals: marks.flatMap((m) => (m.accidental ? [m.accidental] : [])),
      expressionMarks: exprMarks.slice(0, 40),
      expression: exprFindings,
    });
  }, [pieceName, pieceLabels, status, measure, remaining, wrongCount, feedback, pace, marks, noteName, loopBars, lap, lapBpm, picking, exprMarks, exprFindings]);

  // Where a played note goes: x from the written notehead(s) at that step, y
  // from the staff's top line plus the diatonic offset of the played pitch,
  // spelled against the key and what is written there.
  const placePlayed = useCallback(
    (stepIdx: number, midi: number, wrong: boolean): PlayedMark | null => {
      const osmd = osmdRef.current;
      const layer = layerRef.current;
      const step = followerRef.current?.steps[stepIdx];
      const stepNotes = stepNotesRef.current[stepIdx] ?? [];
      const ringNotes = ringNotesRef.current[stepIdx] ?? [];
      const container = containerRef.current;
      if (!osmd || !layer || !step || !container || stepNotes.length === 0) return null;
      const svg = pageSvgOf(osmd, container, step.measure - 1);
      if (!svg) return null;
      try {
        const staves = osmd.Sheet.Staves.length;
        // Which staff: the one this pitch is written on here; else the staff of the
        // nearest written note. Pitch alone fails with two treble staves (#9481).
        // Held-over notes count only on an exact match; "nearest" uses the notes struck here.
        const candidates = [...stepNotes, ...ringNotes];
        const exact = candidates.find((n) => toMidi(n) === midi);
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
        const head = headOf(stepNotes.find((n) => staffOf(n) === staffIdx) ?? stepNotes[0]);
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
  }, []);

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
    const step = f.steps[Math.min(f.index, f.steps.length - 1)];
    setMeasure(step?.measure ?? 1);
    setPace(f.paceBpm);
  }, []);

  const restart = useCallback(() => {
    watchRunRef.current++;
    window.clearTimeout(watchTimerRef.current);
    setWatching(false);
    setWatchNotes([]);
    const bpm = watchBpmRef.current;
    watchBpmRef.current = null;
    if (bpm !== null) reportEvent('watch', { on: false, bpm });
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
    osmd.cursor.cursorElement?.scrollIntoView?.({ block: 'center' });
    setFeedback({ kind: 'idle' });
    setWrongCount(0);
    setLap(f.lap);
    lapStartRef.current = null;
    exprRef.current?.reset();
    exprNewPassRef.current = false;
    setExprFindings([]);
    syncUi();
  }, [moveCursorTo, syncUi, trackChord]);

  const buildFollower = useCallback((osmd: OpenSheetMusicDisplay) => {
    const { steps, notes, ringing, chords } = extractSteps(osmd, handRef.current);
    stepNotesRef.current = notes;
    ringNotesRef.current = ringing;
    stepChordsRef.current = chords;
    trackChord(null, []);
    chordLitRef.current = noChord();
    followerRef.current = new ScoreFollower(steps);
    const exprMarksParsed = parseExpression(piece.xml);
    exprRef.current = new ExpressionTracker(exprMarksParsed, steps);
    setExprMarks(exprMarksParsed.map(describeMark));
    return { steps, exprMarksParsed };
  }, [piece.xml, trackChord]);

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
      if (step.notes.length) playChord(step.notes, durationSeconds);
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
      if (bpm !== null) reportEvent('watch', { on: false, bpm });
    };
  }, [piece.id, piece.xml]);

  // --- loop range (#5004) ---
  const applyLoop = useCallback(
    (bars: { first: number; last: number } | null) => {
      const f = followerRef.current;
      if (!f) return;
      if (bars) {
        const first = Math.min(bars.first, bars.last);
        const last = Math.max(bars.first, bars.last);
        const firstStep = f.steps.findIndex((st) => st.measure >= first);
        let lastStep = -1;
        f.steps.forEach((st, i) => {
          if (st.measure <= last) lastStep = i;
        });
        if (firstStep < 0 || lastStep < firstStep) return;
        f.setRange(firstStep, lastStep);
        setLoopBars({ first, last });
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
    [restart],
  );

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
    const range = loopBars ?? (pickStart !== null ? { first: pickStart, last: pickStart } : null);
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
  }, [loopBars, pickStart, status, layoutTick]);

  // A loop asked for through the tutor API (POST /loop, DELETE /loop). Only a new
  // request (seq) applies; a status flip must not re-apply an old one.
  const ready = status === 'ready';
  useEffect(() => {
    if (!loopRequest || !ready) return;
    applyLoop('clear' in loopRequest ? null : { first: loopRequest.firstBar, last: loopRequest.lastBar });
  }, [loopRequest?.seq, ready]);

  // Esc clears the loop (or cancels picking).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (picking !== 'off') {
        setPicking('off');
        setPickStart(null);
      } else if (loopBars) applyLoop(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picking, loopBars, applyLoop]);

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
  }, [piece.id, piece.xml]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    setStaffCount(0);
    if (!piece.xml) {
      setStatus('photo');
      return;
    }
    let disposed = false;
    setStatus('loading');

    const osmd = new OpenSheetMusicDisplay(container, {
      autoResize: true,
      autoBeam: true,
      backend: 'svg',
      drawTitle: true,
      followCursor: true,
      // Break lines where the printed page does (#5056), so the bar number at the start
      // of each line matches the boxed number on his page.
      newSystemFromXML: true,
      ...(scoreLayout === 'pages' ? { pageFormat: 'A4_P', pageBackgroundColor: '#FFFFFF' } : {}),
    });
    const render = osmd.render.bind(osmd);
    // autoResize calls this.render(), so the instance override covers re-layouts too.
    osmd.render = () => {
      if (scoreLayout === 'pages') fitPages(osmd, container);
      render();
      paintFingerings(osmd, container);
    };
    osmdRef.current = osmd;
    const cursorObs = keepCursorHeight(container);

    osmd
      .load(piece.xml)
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
        setStatus('ready');
        reportEvent('piece', {
          piece: pieceName, steps: steps.length, bars: steps[steps.length - 1]?.measure ?? 0,
          expressionMarks: exprMarksParsed.length,
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
      exprRef.current = null;
    };
    // piece.id too: a re-pushed piece with identical XML must still start fresh.
  }, [piece.id, piece.xml, scoreLayout, restart, buildFollower]);

  // --- live MIDI → follower ---
  useEffect(() => {
    if (!following || watching) return;
    return useMidiStore.subscribe((state, prev) => {
      if (watchBpmRef.current !== null) return;
      const ev = state.lastNoteOn;
      if (!ev || ev === prev.lastNoteOn) return;
      const f = followerRef.current;
      if (!f || status !== 'ready') return;
      // Notes played for an unsolved chord task are not attempts at the piece.
      const task = useTutorStore.getState().task;
      if (task && task.result?.verdict !== 'correct') return;

      const idx = f.index;
      const step = f.steps[idx];
      // Spell against the step he played into, before the cursor moves on.
      const playedName = noteName(ev.note);
      const expectedNames = f.expected.map(noteName);
      // Still ringing: keys held down, plus keys let go under the sustain pedal (#9480).
      const { held, pedal, pedalRinging } = useMidiStore.getState();
      const sounding = new Set([...held, ...(pedal ? pedalRinging : [])]);
      sounding.delete(ev.note);
      trackChord(stepChordsRef.current[idx] ?? null, [ev.note, ...sounding], step?.measure);
      const result = f.noteOn(ev.note, ev.timestamp, sounding);
      if (result.kind !== 'ignored') {
        const mark = placePlayed(idx, ev.note, result.kind === 'wrong');
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
            : undefined,
        step: idx,
        bar: step?.measure,
        velocity: ev.velocity,
        expected: expectedNames,
        pedal,
        sounding: [...sounding],
        lap: f.lap,
      });

      const expr = exprRef.current;
      if (expr && result.kind !== 'wrong' && result.kind !== 'ignored') {
        if (exprNewPassRef.current) {
          expr.reset();
          exprNewPassRef.current = false;
        }
        reportExpression(expr.hit({ step: idx, note: ev.note, velocity: ev.velocity, timeMs: ev.timestamp }));
        if (result.kind === 'complete' || result.kind === 'loop') reportExpression(expr.finish());
        if (result.kind === 'loop') exprNewPassRef.current = true;
      }

      if (lapStartRef.current === null && result.kind !== 'wrong' && result.kind !== 'ignored') {
        lapStartRef.current = ev.timestamp;
      }

      switch (result.kind) {
        case 'partial':
          break;
        case 'advance':
          moveCursorTo(result.to);
          setFeedback({ kind: 'idle' });
          break;
        case 'loop': {
          // One lap done: its average tempo, then a clean page for the next lap.
          const range = f.range;
          const start = lapStartRef.current;
          if (range && start !== null && ev.timestamp > start) {
            const beats = f.steps[result.from].beat - f.steps[range.first].beat;
            if (beats > 0) setLapBpm(Math.round(beats / ((ev.timestamp - start) / 60000)));
          }
          lapStartRef.current = null;
                setMarks([]);
          moveCursorTo(result.to);
          setLap(result.lap);
          setFeedback({ kind: 'idle' });
          reportEvent('lap', { lap: result.lap });
          break;
        }
        case 'complete':
          setFeedback({ kind: 'complete' });
          break;
        case 'wrong': {
          setWrongCount((c) => c + 1);
          setFeedback({
            kind: 'wrong',
            played: result.played,
            expected: result.expected,
            remaining: result.remaining,
            hint: hintFor(osmdRef.current, stepNotesRef.current[idx] ?? [], result.remaining),
          });
          // Only his note goes red (drawn above); the panel ring flashes.
          setWrongFlash(true);
          window.clearTimeout(flashTimerRef.current);
          flashTimerRef.current = window.setTimeout(() => setWrongFlash(false), 450);
          break;
        }
        case 'ignored':
          break;
      }
      syncUi();
    });
  }, [following, watching, status, moveCursorTo, syncUi, placePlayed, noteName, trackChord, reportExpression]);

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

  // --- manual cursor controls (re-sync the follower to wherever the cursor lands) ---
  const manualMove = (delta: number) => {
    const f = followerRef.current;
    if (!f) return;
    const target = Math.max(0, Math.min(f.steps.length - 1, cursorIndexRef.current + delta));
    f.seek(target);
    // A jump starts a new pass: spans he skipped must not be judged.
    exprRef.current?.reset();
    moveCursorTo(Math.min(f.index, f.steps.length - 1));
    setFeedback({ kind: 'idle' });
    syncUi();
  };

  // Red on the strip while a wrong key is down. The latest wrong note counts even when
  // the overlay could not place a mark for it on the staff.
  const wrongKeys = new Set(
    [...marks.flatMap((m) => (m.wrong && m.midi !== undefined ? [m.midi] : [])), ...(feedback.kind === 'wrong' ? [feedback.played] : [])].filter(
      (k) => held.has(k),
    ),
  );
  const finished = feedback.kind === 'complete';
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

  return (
    <div className="flex w-full flex-col gap-3">
      <TaskPanel />
      {/* Sticky so Restart / loop / piece stay on screen in full screen and when the
          cursor scrolls the score (#9480). */}
      <div className="sticky top-0 z-20 -mx-2 flex flex-col gap-2 rounded-b-md bg-gray-950/95 px-2 py-2 backdrop-blur">
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
          <optgroup label="All pieces">
            {otherPieces.map((p) => (
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
        {window.tutorBridge && (
          <button onClick={openPiece} className={btn}>
            Open piece…
          </button>
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
        <button
          data-testid="layout-toggle"
          onClick={() => setScoreLayout(scoreLayout === 'scroll' ? 'pages' : 'scroll')}
          title="Switch between two pages side by side and one long scrolling page"
          className={btn}
        >
          {scoreLayout === 'scroll' ? 'Pages side by side' : 'Scroll'}
        </button>
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
        <label className="ml-2 flex items-center gap-1.5 text-sm text-gray-300">
          <input type="checkbox" checked={following} onChange={(e) => setFollowing(e.target.checked)} />
          Follow my playing
        </label>
        <label className="ml-2 flex items-center gap-1.5 text-sm text-gray-300">
          <input type="checkbox" checked={showKeyboard} onChange={(e) => setShowKeyboard(e.target.checked)} />
          Keyboard
        </label>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => {
              setPicking(picking === 'off' ? 'start' : 'off');
              setPickStart(null);
            }}
            disabled={status !== 'ready' || watching}
            className={`${btn} ${loopBtn}`}
            data-testid="loop-bars"
          >
            {picking === 'start' ? 'Click first bar…' : picking === 'end' ? 'Click last bar…' : 'Loop bars'}
          </button>
          {loopBars && (
            <button onClick={() => applyLoop(null)} disabled={watching} className={btn} data-testid="clear-loop">
              Clear loop
            </button>
          )}
          {/* While it plays for him, the timer owns the cursor. */}
          <button onClick={() => manualMove(-1)} disabled={status !== 'ready' || watching} className={btn}>
            ◀ Prev
          </button>
          <button onClick={() => manualMove(1)} disabled={status !== 'ready' || finished || watching} className={btn}>
            Next ▶
          </button>
          <button onClick={toggleWatch} disabled={status !== 'ready'} className={btn} data-testid="watch">
            {watching ? '■ Stop' : '▶ Play it for me'}
          </button>
          <button
            onClick={restart}
            disabled={status !== 'ready'}
            className="rounded-md bg-indigo-600 px-3 py-1 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            Restart
          </button>
        </div>
      </div>

      {status === 'ready' && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-md bg-gray-900/60 px-3 py-2 text-sm">
          <span className="text-gray-400">
            Bar <span className="font-mono text-gray-200">{measure}</span>
          </span>
          <span className="text-gray-400" data-testid="next-notes">
            Play:{' '}
            <span className="font-mono font-semibold text-indigo-300">
              {finished ? '—' : remaining.length ? namesOf(remaining) : '—'}
            </span>
            {!finished && playHint && <span className="text-indigo-200/80"> ({playHint})</span>}
          </span>
          <span className="text-gray-400">
            Wrong notes: <span className="font-mono text-gray-200">{wrongCount}</span>
          </span>
          {loopBars && (
            <span className="text-yellow-300" data-testid="loop-status">
              Loop bars {loopBars.first}–{loopBars.last} · Lap <span className="font-mono">{lap}</span>
              {lapBpm && <span className="text-yellow-200/80"> (last lap ♩ = {lapBpm})</span>}
            </span>
          )}
          {/* His live tempo, big enough to read from the bench (#8979). */}
          <span className="text-gray-400" data-testid="tempo">
            <span className="font-mono text-2xl font-bold text-white">♩ = {pace ?? '—'}</span>
            {piece.targetBpm && <span className="text-gray-500"> (target {piece.targetBpm})</span>}
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
        </div>
      )}
      </div>

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
      <div
        onClick={onScoreClick}
        className={`overflow-x-auto rounded-lg bg-white p-4 ring-4 transition-shadow ${
          wrongFlash ? 'ring-red-500' : 'ring-transparent'
        } ${picking !== 'off' ? 'cursor-pointer' : ''}`}
      >
        {showPhoto && piece.photo && (
          <img src={piece.photo} alt={`Photo of ${piece.label}`} className="mx-auto max-h-[70vh] w-auto max-w-full" />
        )}
        <div ref={layerRef} className={showPhoto ? 'hidden' : 'relative'}>
          {/* OSMD makes each page as wide as this container, so it is half the panel and
              the second column of pages overflows into the other half on purpose. */}
          <div
            ref={containerRef}
            className={scoreLayout === 'pages' ? 'score-pages' : undefined}
            style={scoreLayout === 'pages' ? {
              width: 'calc((100% - 1.5rem) / 2)',
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 100%)',
              columnGap: '1.5rem',
              rowGap: '1.5rem',
              alignItems: 'start',
            } : undefined}
          />
          <PlayedOverlay marks={marks} bands={bands} />
        </div>
      </div>
      {showKeyboard && (
        <div className="sticky bottom-0 z-20 -mx-2 rounded-t-md bg-gray-950/95 px-2 py-1" data-testid="keyboard-strip">
          <PianoKeyboard88 heightRatio={20} green={new Set(watching ? watchNotes : stepKeys)} red={wrongKeys} held={held} />
        </div>
      )}
    </div>
  );
}
