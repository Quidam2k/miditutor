import { useCallback, useEffect, useRef, useState } from 'react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
// eslint-disable-next-line import/no-unresolved -- Vite ?raw import, not resolvable by eslint-plugin-import
import sampleXml from '../../assets/sample-score.musicxml?raw';
// eslint-disable-next-line import/no-unresolved -- Vite ?raw import, not resolvable by eslint-plugin-import
import minuetXml from '../../assets/minuet-in-g.musicxml?raw';
import { useMidiStore } from '../../store/useMidiStore';
import { ScoreFollower, ScoreStep } from '../../engine/ScoreFollower';
import { midiNumberToPitch, pitchToDisplayName } from '../../engine/MusicTheory';

// Milestone 2: the score follows live MIDI. Each OSMD cursor position becomes a
// ScoreStep (the notes that must be newly struck there); ScoreFollower decides
// when to advance. Correct notes turn green, a wrong note flashes the expected
// notes red and does not advance. Manual prev/next/reset still work and re-sync
// the follower. OSMD handles real scores; VexFlow stays for generated drills.

interface Piece {
  id: string;
  label: string;
  xml: string;
  targetBpm?: number;
}

const PIECES: Piece[] = [
  { id: 'minuet', label: 'Minuet in G (simplified) — Petzold', xml: minuetXml, targetBpm: 100 },
  { id: 'sample', label: 'Sample: C scale + Ode to Joy', xml: sampleXml },
];

// Minimal structural view of the OSMD internals we touch; OSMD's own types are
// deep and partly internal, so we narrow to what we use and guard at runtime.
interface OsmdNote {
  halfTone: number;
  isRest(): boolean;
  IsGraceNote?: boolean;
  NoteTie?: { StartNote?: unknown } | null;
}
interface OsmdGraphicalNote {
  getSVGGElement?: () => SVGGElement | undefined;
}

const GREEN = '#16a34a';
const RED = '#dc2626';

const noteName = (midi: number) => pitchToDisplayName(midiNumberToPitch(midi));
const namesOf = (midis: number[]) =>
  [...midis].sort((a, b) => b - a).map(noteName).join(' + ');

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
function extractSteps(osmd: OpenSheetMusicDisplay): { steps: ScoreStep[]; notes: OsmdNote[][] } {
  const steps: ScoreStep[] = [];
  const notes: OsmdNote[][] = [];
  const cursor = osmd.cursor;
  cursor.reset();
  for (let guard = 0; guard < 20000 && !cursor.iterator.EndReached; guard++) {
    const under = (cursor.NotesUnderCursor() as unknown as OsmdNote[]).filter(isStruck);
    steps.push({
      notes: under.map(toMidi),
      beat: cursor.iterator.currentTimeStamp.RealValue * 4,
      measure: cursor.iterator.CurrentMeasureIndex + 1,
    });
    notes.push(under);
    cursor.next();
  }
  cursor.reset();
  return { steps, notes };
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
  const cursorIndexRef = useRef(0);
  const paintedRef = useRef<Set<SVGGElement>>(new Set());
  const flashTimerRef = useRef<number | undefined>(undefined);

  const [pieceId, setPieceId] = useState(PIECES[0].id);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [following, setFollowing] = useState(true);
  const [remaining, setRemaining] = useState<number[]>([]);
  const [measure, setMeasure] = useState(1);
  const [feedback, setFeedback] = useState<Feedback>({ kind: 'idle' });
  const [wrongCount, setWrongCount] = useState(0);
  const [pace, setPace] = useState<number | null>(null);
  const [wrongFlash, setWrongFlash] = useState(false);

  const piece = PIECES.find((p) => p.id === pieceId) ?? PIECES[0];

  // --- note colouring (direct SVG edits; cheaper than an OSMD re-render) ---
  const paint = useCallback((notes: OsmdNote[], color: string | null) => {
    const osmd = osmdRef.current;
    if (!osmd) return;
    for (const n of notes) {
      try {
        const g = osmd.EngravingRules.GNote(n as never) as unknown as OsmdGraphicalNote | undefined;
        const el = g?.getSVGGElement?.();
        if (!el) continue;
        el.querySelectorAll<SVGElement>('path, rect').forEach((p) => {
          p.style.fill = color ?? '';
          p.style.stroke = color ?? '';
        });
        if (color) paintedRef.current.add(el);
      } catch {
        /* colouring is cosmetic; never break following over it */
      }
    }
  }, []);

  const clearPaint = useCallback(() => {
    paintedRef.current.forEach((el) =>
      el.querySelectorAll<SVGElement>('path, rect').forEach((p) => {
        p.style.fill = '';
        p.style.stroke = '';
      }),
    );
    paintedRef.current.clear();
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
    clearPaint();
    osmd.cursor.reset();
    osmd.cursor.show();
    cursorIndexRef.current = 0;
    f.reset();
    moveCursorTo(f.index);
    setFeedback({ kind: 'idle' });
    setWrongCount(0);
    syncUi();
  }, [clearPaint, moveCursorTo, syncUi]);

  // --- load + render the selected piece ---
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
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
        const { steps, notes } = extractSteps(osmd);
        stepNotesRef.current = notes;
        followerRef.current = new ScoreFollower(steps);
        paintedRef.current.clear();
        restart();
        setStatus('ready');
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
  }, [piece.xml, restart]);

  // --- live MIDI → follower ---
  useEffect(() => {
    if (!following) return;
    return useMidiStore.subscribe((state, prev) => {
      const ev = state.lastNoteOn;
      if (!ev || ev === prev.lastNoteOn) return;
      const f = followerRef.current;
      if (!f || status !== 'ready') return;

      const idx = f.index;
      const result = f.noteOn(ev.note, ev.timestamp);
      const stepNotes = stepNotesRef.current[idx] ?? [];
      const hit = stepNotes.filter((n) => toMidi(n) === ev.note);

      switch (result.kind) {
        case 'partial':
          paint(hit, GREEN);
          break;
        case 'advance':
          paint(hit, GREEN);
          moveCursorTo(result.to);
          setFeedback({ kind: 'idle' });
          break;
        case 'complete':
          paint(hit, GREEN);
          setFeedback({ kind: 'complete' });
          break;
        case 'wrong': {
          setWrongCount((c) => c + 1);
          setFeedback({ kind: 'wrong', played: result.played, expected: result.expected });
          // Flash the still-needed notes red, then restore (already-hit ones stay green).
          const pending = stepNotes.filter((n) => !f.satisfied.has(toMidi(n)));
          paint(pending, RED);
          setWrongFlash(true);
          window.clearTimeout(flashTimerRef.current);
          flashTimerRef.current = window.setTimeout(() => {
            if (followerRef.current === f && f.index === idx) paint(pending, null);
            setWrongFlash(false);
          }, 450);
          break;
        }
        case 'ignored':
          break;
      }
      syncUi();
    });
  }, [following, status, paint, moveCursorTo, syncUi]);

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

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={pieceId}
          onChange={(e) => setPieceId(e.target.value)}
          className="rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm text-gray-200"
        >
          {PIECES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <label className="ml-2 flex items-center gap-1.5 text-sm text-gray-300">
          <input type="checkbox" checked={following} onChange={(e) => setFollowing(e.target.checked)} />
          Follow my playing
        </label>
        <div className="ml-auto flex items-center gap-2">
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
          <span className="text-gray-400">
            Pace:{' '}
            <span className="font-mono text-gray-200">{pace ? `~${pace} bpm` : '—'}</span>
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

      {status === 'error' && (
        <p className="rounded-md border border-red-800/50 bg-red-900/20 p-3 text-sm text-red-300">
          Failed to render score: {errorMsg}
        </p>
      )}
      {status === 'loading' && <p className="text-sm text-gray-500">Loading score…</p>}

      {/* OSMD draws black notation, so give it a light panel. Red ring = wrong note. */}
      <div
        className={`overflow-x-auto rounded-lg bg-white p-4 ring-4 transition-shadow ${
          wrongFlash ? 'ring-red-500' : 'ring-transparent'
        }`}
      >
        <div ref={containerRef} />
      </div>
    </div>
  );
}
