import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
// eslint-disable-next-line import/no-unresolved -- Vite ?raw import, not resolvable by eslint-plugin-import
import sampleXml from '../../assets/sample-score.musicxml?raw';
// eslint-disable-next-line import/no-unresolved -- Vite ?raw import, not resolvable by eslint-plugin-import
import minuetXml from '../../assets/minuet-in-g.musicxml?raw';
// eslint-disable-next-line import/no-unresolved -- Vite ?raw import, not resolvable by eslint-plugin-import
import aMinorXml from '../../assets/a-minor-scale.musicxml?raw';
import { useMidiStore } from '../../store/useMidiStore';
import { ScoreFollower, ScoreStep } from '../../engine/ScoreFollower';
import { useTutorStore } from '../../store/useTutorStore';
import { reportEvent, reportScreen } from '../tutor/useTutorBridge';
import { TaskPanel } from '../tutor/TaskPanel';
import { Band, PlayedOverlay, PlayedMark } from './PlayedOverlay';
import {
  WrittenNote,
  accidentalMark,
  clefForMidi,
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
}

const PIECES: Piece[] = [
  { id: 'minuet', label: 'Minuet in G (simplified) — Petzold', xml: minuetXml, targetBpm: 100 },
  { id: 'a-minor', label: 'A minor scale (natural, hands together)', xml: aMinorXml },
  { id: 'sample', label: 'Sample: C scale + Ode to Joy', xml: sampleXml },
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
  ParentStaffLine?: { PositionAndShape: { AbsolutePosition: { y: number } } };
  PositionAndShape?: OsmdBox;
}
interface OsmdGraphicalNote {
  getSVGGElement?: () => SVGGElement | undefined;
}

const LETTER_OF: Record<number, WrittenNote['letter']> = { 0: 'C', 2: 'D', 4: 'E', 5: 'F', 7: 'G', 9: 'A', 11: 'B' };

// OSMD pitch -> MusicXML-style spelling (OSMD octave 1 = MusicXML octave 4).
function writtenOf(n: OsmdNote): WrittenNote | null {
  const p = n.Pitch;
  const letter = p && LETTER_OF[p.FundamentalNote];
  return letter ? { letter, alter: p.AccidentalHalfTones, octave: p.Octave + 3 } : null;
}

const staffOf = (n: OsmdNote) => n.ParentStaff?.idInMusicSheet ?? 0;

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
function extractSteps(osmd: OpenSheetMusicDisplay): { steps: ScoreStep[]; notes: OsmdNote[][]; ringing: OsmdNote[][] } {
  const steps: ScoreStep[] = [];
  const notes: OsmdNote[][] = [];
  const ringing: OsmdNote[][] = [];
  let active: { note: OsmdNote; end: number }[] = [];
  const cursor = osmd.cursor;
  cursor.reset();
  for (let guard = 0; guard < 20000 && !cursor.iterator.EndReached; guard++) {
    const all = cursor.NotesUnderCursor() as unknown as OsmdNote[];
    const under = all.filter(isStruck);
    const beat = cursor.iterator.currentTimeStamp.RealValue * 4;
    active = active.filter((a) => a.end > beat + 1e-6);
    const ring = [...active.map((a) => a.note), ...all.filter((n) => !n.isRest() && !isStruck(n))];
    steps.push({
      notes: under.map(toMidi),
      beat,
      measure: cursor.iterator.CurrentMeasureIndex + 1,
      ringing: [...new Set(ring.map(toMidi))],
    });
    notes.push(under);
    ringing.push(ring);
    for (const n of all) {
      if (!n.isRest() && n.Length) active.push({ note: n, end: beat + n.Length.RealValue * 4 });
    }
    cursor.next();
  }
  cursor.reset();
  return { steps, notes, ringing };
}

// Pixel box of every bar (all staves of one system), relative to the score's <svg>.
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
  | { kind: 'wrong'; played: number; expected: number[] }
  | { kind: 'complete' };

export function ScoreView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const followerRef = useRef<ScoreFollower | null>(null);
  const stepNotesRef = useRef<OsmdNote[][]>([]);
  const ringNotesRef = useRef<OsmdNote[][]>([]);
  const lapStartRef = useRef<number | null>(null);
  const cursorIndexRef = useRef(0);
  const flashTimerRef = useRef<number | undefined>(undefined);
  const layerRef = useRef<HTMLDivElement>(null);
  const markIdRef = useRef(0);
  const [marks, setMarks] = useState<PlayedMark[]>([]);

  const [pieceId, setPieceId] = useState(PIECES[0].id);
  // 'photo': a pushed piece with no readable score yet, only its photo to show.
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'photo'>('loading');
  const [view, setView] = useState<'score' | 'photo'>('score');
  const [openError, setOpenError] = useState('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [following, setFollowing] = useState(true);
  const [remaining, setRemaining] = useState<number[]>([]);
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

  // Built-in pieces, his Pieces folder on disk, then anything pushed this session.
  // The folder is re-read when the window regains focus, so a synced file shows up.
  const [folder, setFolder] = useState<Piece[]>([]);
  useEffect(() => {
    const list = window.tutorBridge?.listPieces;
    if (!list) return;
    let lastKey = '';
    const refresh = () =>
      list()
        .then((files) => {
          const key = files.map((f) => `${f.file}:${f.musicxml.length}`).join('|');
          if (key === lastKey) return;
          lastKey = key;
          setFolder(files.map((f) => ({ id: `file:${f.file}`, label: f.title, xml: f.musicxml })));
        })
        .catch((err) => console.warn('[pieces] list failed:', err));
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  const pushed = useTutorStore((s) => s.pieces);
  const selectPieceId = useTutorStore((s) => s.selectPieceId);
  // A pushed score is also saved to the folder; list it once.
  const pushedLabels = new Set(pushed.map((p) => p.label));
  const pieces: Piece[] = [...PIECES, ...folder.filter((p) => !pushedLabels.has(p.label)), ...pushed];
  useEffect(() => {
    if (selectPieceId) setPieceId(selectPieceId);
  }, [selectPieceId]);
  const piece = pieces.find((p) => p.id === pieceId) ?? PIECES[0];
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
      piece: piece.label,
      pieces: pieceLabels.split('\n'),
      status,
      measure,
      remaining: remaining.map(noteName),
      wrongCount,
      feedback:
        feedback.kind === 'wrong'
          ? { kind: 'wrong', played: noteName(feedback.played), expected: feedback.expected.map(noteName) }
          : feedback,
      paceBpm: pace,
      loop: loopBars ? { firstBar: loopBars.first, lastBar: loopBars.last, lap, lastLapBpm: lapBpm } : null,
      pickingLoop: picking === 'off' ? null : picking,
      playedMarks: marks.length,
      wrongMarks: marks.filter((m) => m.wrong).length,
      redAccidentals: marks.flatMap((m) => (m.accidental ? [m.accidental] : [])),
    });
  }, [piece.label, pieceLabels, status, measure, remaining, wrongCount, feedback, pace, marks, noteName, loopBars, lap, lapBpm, picking]);

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
      const svg = containerRef.current?.querySelector('svg');
      if (!osmd || !layer || !step || !svg || stepNotes.length === 0) return null;
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

        const written = onStaff.map(writtenOf).filter((w): w is WrittenNote => w !== null);
        const spelled = spellPlayed(midi, fifths, written);
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

  const syncUi = useCallback(() => {
    const f = followerRef.current;
    if (!f) return;
    setRemaining(f.expected.filter((m) => !f.satisfied.has(m)));
    const step = f.steps[Math.min(f.index, f.steps.length - 1)];
    setMeasure(step?.measure ?? 1);
    setPace(f.paceBpm);
  }, []);

  const restart = useCallback(() => {
    const osmd = osmdRef.current;
    const f = followerRef.current;
    if (!osmd || !f) return;
    setMarks([]);
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
    syncUi();
  }, [moveCursorTo, syncUi]);

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
    const svg = containerRef.current?.querySelector('svg');
    if (!osmd || !svg) return null;
    const r = svg.getBoundingClientRect();
    const x = clientX - r.left;
    const y = clientY - r.top;
    for (const [bar, b] of barBoxes(osmd)) {
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
    const svg = containerRef.current?.querySelector('svg');
    const layer = layerRef.current;
    const range = loopBars ?? (pickStart !== null ? { first: pickStart, last: pickStart } : null);
    if (!osmd || !svg || !layer || !range || status !== 'ready') {
      setBands([]);
      return;
    }
    try {
      const dx = svg.getBoundingClientRect().left - layer.getBoundingClientRect().left;
      const dy = svg.getBoundingClientRect().top - layer.getBoundingClientRect().top;
      const out: Band[] = [];
      for (const [bar, b] of barBoxes(osmd)) {
        if (bar >= range.first && bar <= range.last) out.push({ ...b, x: b.x + dx, y: b.y + dy });
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

  // --- load + render the selected piece ---
  useEffect(() => {
    // The photo view is the default when there is no score to show.
    setView(piece.xml ? 'score' : 'photo');
  }, [piece.id, piece.xml]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
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
    });
    osmdRef.current = osmd;
    const cursorObs = keepCursorHeight(container);

    osmd
      .load(piece.xml)
      .then(() => {
        if (disposed) return;
        osmd.render();
        osmd.cursor.show();
        const { steps, notes, ringing } = extractSteps(osmd);
        stepNotesRef.current = notes;
        ringNotesRef.current = ringing;
        followerRef.current = new ScoreFollower(steps);
        setLoopBars(null);
        setPicking('off');
        setPickStart(null);
        restart();
        setStatus('ready');
        reportEvent('piece', { piece: piece.label, steps: steps.length, bars: steps[steps.length - 1]?.measure ?? 0 });
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
    };
    // piece.id too: a re-pushed piece with identical XML must still start fresh.
  }, [piece.id, piece.xml, restart]);

  // --- live MIDI → follower ---
  useEffect(() => {
    if (!following) return;
    return useMidiStore.subscribe((state, prev) => {
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
        expected: expectedNames,
        pedal,
        sounding: [...sounding],
        lap: f.lap,
      });

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
          setFeedback({ kind: 'wrong', played: result.played, expected: result.expected });
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
  }, [following, status, moveCursorTo, syncUi, placePlayed, noteName]);

  // OSMD re-renders on resize, which moves every note; drop stale marks.
  useEffect(() => {
    let timer: number | undefined;
    const onResize = () => {
      setMarks([]);
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
    moveCursorTo(Math.min(f.index, f.steps.length - 1));
    setFeedback({ kind: 'idle' });
    syncUi();
  };

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
          {pieces.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
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
        <label className="ml-2 flex items-center gap-1.5 text-sm text-gray-300">
          <input type="checkbox" checked={following} onChange={(e) => setFollowing(e.target.checked)} />
          Follow my playing
        </label>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => {
              setPicking(picking === 'off' ? 'start' : 'off');
              setPickStart(null);
            }}
            disabled={status !== 'ready'}
            className={`${btn} ${loopBtn}`}
            data-testid="loop-bars"
          >
            {picking === 'start' ? 'Click first bar…' : picking === 'end' ? 'Click last bar…' : 'Loop bars'}
          </button>
          {loopBars && (
            <button onClick={() => applyLoop(null)} className={btn} data-testid="clear-loop">
              Clear loop
            </button>
          )}
          <button onClick={() => manualMove(-1)} disabled={status !== 'ready'} className={btn}>
            ◀ Prev
          </button>
          <button onClick={() => manualMove(1)} disabled={status !== 'ready' || finished} className={btn}>
            Next ▶
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
                ✗ {noteName(feedback.played)} — expected {namesOf(feedback.expected)}
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
          <div ref={containerRef} />
          <PlayedOverlay marks={marks} bands={bands} />
        </div>
      </div>
    </div>
  );
}
