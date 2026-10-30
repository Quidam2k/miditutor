import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { StaffDisplay } from '../staff/StaffDisplay';
import { useMidiStore } from '../../store/useMidiStore';
import { useSettingsStore, localDay } from '../../store/useSettingsStore';
import {
  DayTally,
  NoteStats,
  KEY_HOLD_NOTES,
  TrainerNote,
  notePool,
  parseDayTally,
  parseNoteStats,
  pickInKey,
  pickKey,
  pickNext,
  recordAnswer,
  recordDay,
  slowestNotes,
} from '../../engine/NoteTrainer';
import { MajorKey, midiNumberToPitch, pitchToDisplayName, wrongPitches } from '../../engine/MusicTheory';
import { Pitch } from '../../types/music';
import { playNote, initAudio, isInitialized } from '../../audio/AudioEngine';

const HIT_HOLD_MS = 800;
const MISS_HOLD_MS = 1500;
/** More ledger lines than this and the 180 px staff clips: the line of text still says it. */
const MAX_DRAWN_LEDGER_STEPS = 9;

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** Diatonic steps outside the staff: the top and bottom lines are 0. */
function stepsOffStaff(pitch: Pitch, clef: TrainerNote['clef']): number {
  const step = pitch.octave * 7 + 'CDEFGAB'.indexOf(pitch.note);
  const [bottom, top] = clef === 'treble' ? [4 * 7 + 2, 5 * 7 + 3] : [2 * 7 + 4, 3 * 7 + 5]; // E4-F5, G2-A3
  return Math.max(bottom - step, step - top, 0);
}

interface Feedback {
  correct: boolean;
  line: string;
  wrong: Pitch[];
}

interface TrainerRecord {
  stats: NoteStats;
  today: DayTally | null;
}

// One read per launch: this tab remounts on every switch, and a re-read could land before
// the last answer's write.
let record: Promise<TrainerRecord> | null = null;

function readRecord(): Promise<TrainerRecord> {
  record ??= (window.tutorBridge?.noteStatsLoad?.() ?? Promise.resolve(null))
    .catch((err: unknown) => {
      console.warn('[note-stats] load failed:', err);
      return null;
    })
    .then((raw) => {
      const saved = raw as { stats?: unknown; today?: unknown } | null;
      return { stats: parseNoteStats(saved?.stats), today: parseDayTally(saved?.today) };
    });
  return record;
}

/**
 * Every answer goes straight to main, which writes it atomically: localStorage can lose its
 * last writes to a kill, and this record is the point of the drill.
 */
function saveRecord(next: TrainerRecord): void {
  record = Promise.resolve(next);
  window.tutorBridge?.noteStatsSave?.(next);
}

export function NoteExercise() {
  const { trainerClef, trainerAccidentals, showNoteNames } = useSettingsStore();
  // Null until the file is read: nothing is asked or counted before then, or a save would
  // overwrite weeks of record with one answer.
  const [mine, setMine] = useState<TrainerRecord | null>(null);
  const [current, setCurrent] = useState<TrainerNote | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const mineRef = useRef<TrainerRecord>({ stats: {}, today: null });
  const presentedAt = useRef(0);
  // The first note after opening the tab may have sat there for minutes: it counts, but isn't timed.
  const timed = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const answering = useRef(false);

  const currentRef = useRef<TrainerNote | null>(null);
  const [musicKey, setMusicKey] = useState<MajorKey | null>(null);
  const keyRef = useRef<MajorKey | null>(null);
  const keyNotesLeft = useRef(0);

  const ask = useCallback((isTimed: boolean) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const { trainerClef: clef, trainerAccidentals: useKeys } = useSettingsStore.getState();
    const { stats } = mineRef.current;
    const avoid = currentRef.current?.id;
    let next: TrainerNote;
    let newKey = false;
    if (useKeys) {
      if (keyNotesLeft.current <= 0 || !keyRef.current) {
        keyRef.current = pickKey(keyRef.current);
        keyNotesLeft.current = KEY_HOLD_NOTES;
        newKey = true;
      }
      keyNotesLeft.current--;
      next = pickInKey(clef, keyRef.current, stats, avoid);
    } else {
      keyRef.current = null;
      next = pickNext(notePool(clef, false), stats, avoid);
    }
    currentRef.current = next;
    answering.current = true;
    // A new signature takes reading first: that isn't this note's time.
    timed.current = isTimed && !newKey;
    presentedAt.current = Date.now();
    setMusicKey(keyRef.current);
    setCurrent(next);
    setFeedback(null);
  }, []);

  useEffect(() => {
    let live = true;
    readRecord().then((saved) => {
      if (!live) return;
      mineRef.current = saved;
      setMine(saved);
    });
    return () => {
      live = false;
    };
  }, []);

  // A new clef or Keys setting takes effect on the next note, straight away.
  const loaded = mine !== null;
  useEffect(() => {
    if (loaded) ask(false);
  }, [loaded, trainerClef, trainerAccidentals, ask]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // Audio needs a click (autoplay policy), and there's no Start button to supply one any more.
  // Listen whether Audio is on or not: the click that turns it on is the one that has to count.
  useEffect(() => {
    if (isInitialized()) return;
    const start = () => void initAudio();
    window.addEventListener('pointerdown', start, { once: true });
    return () => window.removeEventListener('pointerdown', start);
  }, []);

  const keep = useCallback((next: TrainerRecord) => {
    mineRef.current = next;
    setMine(next);
    saveRecord(next);
  }, []);

  // Subscribe to every note-on, as the interval drill does: only the first press answers.
  useEffect(() => {
    return useMidiStore.subscribe((state, prev) => {
      const ev = state.lastNoteOn;
      const asked = currentRef.current;
      if (!ev || ev === prev.lastNoteOn || !asked || !answering.current) return;
      answering.current = false;

      const correct = ev.note === asked.pitch.midiNumber;
      // With the name printed he's reading a label, not the staff: it counts, but isn't timed.
      const settings = useSettingsStore.getState();
      const ms = timed.current && !settings.showNoteNames ? Date.now() - presentedAt.current : null;
      keep({
        stats: recordAnswer(mineRef.current.stats, asked.id, correct, ms),
        today: recordDay(mineRef.current.today, localDay(), correct, ms),
      });

      const name = pitchToDisplayName(asked.pitch);
      // #10262 "go from here to here": with names off the staff answers, not a letter.
      const names = settings.showNoteNames;
      if (correct) {
        setFeedback({ correct, line: names ? `You played ${name}` : ms === null ? '' : seconds(ms), wrong: [] });
      } else {
        const key = keyRef.current;
        const played = key
          ? midiNumberToPitch(ev.note, key.fifths < 0)
          : wrongPitches([ev.note], [asked.pitch.midiNumber], [asked.pitch])[0];
        const drawable = stepsOffStaff(played, asked.clef) <= MAX_DRAWN_LEDGER_STEPS;
        const words = ev.note < asked.pitch.midiNumber ? 'Much lower' : 'Much higher';
        setFeedback({
          correct,
          line: names ? `You played ${pitchToDisplayName(played)}, it was ${name}` : drawable ? '' : words,
          // The target stays black; the key he played is drawn red beside it (#4045).
          wrong: drawable ? [played] : [],
        });
        // No sound effects (#5059); with Audio on he hears the right note.
        if (settings.audioEnabled) playNote(asked.pitch.midiNumber);
      }
      timer.current = setTimeout(() => ask(true), correct ? HIT_HOLD_MS : MISS_HOLD_MS);
    });
  }, [ask, keep]);

  const resetStats = () => {
    if (!window.confirm('Clear your speed and hit rate for every note?')) return;
    keep({ stats: {}, today: null });
  };

  const day = mine?.today?.day === localDay() ? mine.today : null;
  const hitRate = day && day.attempts > 0 ? Math.round((day.hits / day.attempts) * 100) : null;
  const slowest = useMemo(() => slowestNotes(mine?.stats ?? {}, 5), [mine]);

  return (
    <div
      className="flex flex-col items-center gap-4 w-full"
      data-testid="note-trainer"
      data-note-id={current?.id}
      data-midi={current?.pitch.midiNumber}
      data-key={musicKey?.name}
    >
      <div className="relative w-full max-w-2xl">
        <StaffDisplay
          notes={current ? [current.pitch] : []}
          clef={current?.clef ?? (trainerClef === 'bass' ? 'bass' : 'treble')}
          highlightColor={feedback?.correct ? 'green' : null}
          wrongNotes={feedback?.wrong}
          musicKey={musicKey}
        />
      </div>

      <div
        data-testid="note-feedback"
        className={`h-7 text-lg font-semibold ${feedback ? (feedback.correct ? 'text-emerald-400' : 'text-red-400') : 'text-gray-200'}`}
      >
        {feedback?.line ?? (showNoteNames && current ? pitchToDisplayName(current.pitch) : '')}
      </div>

      <div className="flex flex-wrap items-start justify-center gap-10 text-sm">
        <div data-testid="note-today">
          <div className="text-gray-500 text-xs uppercase tracking-wider mb-1">Today</div>
          {day ? (
            <div className="text-gray-200">
              {day.attempts} notes · {hitRate}% right
              {day.timedHits > 0 && ` · ${seconds(day.hitMs / day.timedHits)} a note`}
            </div>
          ) : (
            <div className="text-gray-500">Nothing yet</div>
          )}
        </div>
        <div data-testid="note-slowest">
          <div className="text-gray-500 text-xs uppercase tracking-wider mb-1">Your slowest notes</div>
          {slowest.length === 0 && <div className="text-gray-500">Play a few to see them</div>}
          {slowest.map((n) => (
            <div key={n.id} className="flex gap-3 text-gray-200">
              <span className="w-10 font-semibold">{n.name}</span>
              <span className="w-14 text-gray-400">{n.clef}</span>
              <span className="w-12 font-mono">{seconds(n.avgMs)}</span>
              <span className="font-mono text-gray-400">{Math.round(n.hitRate * 100)}% right</span>
            </div>
          ))}
        </div>
      </div>

      {slowest.length > 0 && (
        <button onClick={resetStats} className="text-xs text-gray-500 hover:text-gray-300 underline">
          Reset stats
        </button>
      )}
    </div>
  );
}
