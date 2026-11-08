import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { StaffDisplay } from '../staff/StaffDisplay';
import { useMidiStore } from '../../store/useMidiStore';
import { useSettingsStore, localDay } from '../../store/useSettingsStore';
import {
  KEY_HOLD_NOTES,
  TrainerNote,
  keyPool,
  notePool,
  pickInKey,
  pickKey,
  pickNext,
  recordAnswer,
  recordDay,
  slowestNotes,
} from '../../engine/NoteTrainer';
import { LADDER_FAST_MS, LADDER_RUN, isKnown, ladderLevel, ladderOrder, landmarkCount } from '../../engine/Ladder';
import { recordSlices, sliceKeys, slowestSlices, stepsOffStaff } from '../../engine/Hesitation';
import { dueNotes, pickWithReview, recordReview } from '../../engine/Review';
import { drillPool, liveMixUps, mixUpKind, mixUpLabel, recordMixUp, recordRight } from '../../engine/MixUps';
import { MajorKey, midiNumberToPitch, pitchToDisplayName, wrongPitches } from '../../engine/MusicTheory';
import { Pitch } from '../../types/music';
import { EMPTY_RECORD, TrainerRecord, readRecord, saveRecord } from '../../store/noteRecord';
import { playNote, initAudio, isInitialized } from '../../audio/AudioEngine';

const HIT_HOLD_MS = 800;
const MISS_HOLD_MS = 1500;
/** More ledger lines than this and the 180 px staff clips: the line of text still says it. */
const MAX_DRAWN_LEDGER_STEPS = 9;

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

interface Feedback {
  correct: boolean;
  line: string;
  wrong: Pitch[];
}

const EMPTY = EMPTY_RECORD;
const MIXUPS_SHOWN = 5;

export function NoteExercise() {
  const { trainerClef, trainerAccidentals, trainerLadder, showNoteNames } = useSettingsStore();
  // Null until the file is read: nothing is asked or counted before then, or a save would
  // overwrite weeks of record with one answer.
  const [mine, setMine] = useState<TrainerRecord | null>(null);
  const [current, setCurrent] = useState<TrainerNote | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const mineRef = useRef<TrainerRecord>(EMPTY);
  const presentedAt = useRef(0);
  // The first note after opening the tab may have sat there for minutes: it counts, but isn't timed.
  const timed = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const answering = useRef(false);

  const currentRef = useRef<TrainerNote | null>(null);
  const [musicKey, setMusicKey] = useState<MajorKey | null>(null);
  const keyRef = useRef<MajorKey | null>(null);
  const keyNotesLeft = useRef(0);
  // #5652 D: asking only the notes of his live mix-up pairs. Ends by itself when they're cleared.
  const [drilling, setDrilling] = useState(false);
  const drillingRef = useRef(false);
  const [drillDone, setDrillDone] = useState(false);
  // #5652 A: the note the ladder last added, said once in its panel.
  const [ladderNew, setLadderNew] = useState<string | null>(null);

  const ask = useCallback((isTimed: boolean) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const { trainerClef: clef, trainerAccidentals: useKeys, trainerLadder: onLadder } = useSettingsStore.getState();
    const { stats, mixups, ladder, review } = mineRef.current;
    const avoid = currentRef.current?.id;
    const today = localDay();
    let next: TrainerNote | null = null;
    let newKey = false;
    if (drillingRef.current) {
      const pool = drillPool(liveMixUps(mixups));
      if (pool.length) {
        keyRef.current = null;
        keyNotesLeft.current = 0;
        next = pickNext(pool, stats, avoid);
      } else {
        drillingRef.current = false;
        setDrilling(false);
        setDrillDone(true);
      }
    }
    if (!next && onLadder) {
      keyRef.current = null;
      keyNotesLeft.current = 0;
      const pool = ladderOrder(clef).slice(0, ladderLevel(clef, stats, ladder[clef]));
      next = pickWithReview(pool, stats, review, today, avoid) ?? pickNext(pool, stats, avoid);
    }
    if (next) {
      // A drill or ladder note: no key signature, so each note carries its own accidental.
    } else if (useKeys) {
      if (keyNotesLeft.current <= 0 || !keyRef.current) {
        keyRef.current = pickKey(keyRef.current);
        keyNotesLeft.current = KEY_HOLD_NOTES;
        newKey = true;
      }
      keyNotesLeft.current--;
      const { inKey, outOfKey } = keyPool(clef, keyRef.current);
      next = pickWithReview([...inKey, ...outOfKey], stats, review, today, avoid) ?? pickInKey(clef, keyRef.current, stats, avoid);
    } else {
      keyRef.current = null;
      const pool = notePool(clef, false);
      next = pickWithReview(pool, stats, review, today, avoid) ?? pickNext(pool, stats, avoid);
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
  }, [loaded, trainerClef, trainerAccidentals, trainerLadder, ask]);

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
      const key = keyRef.current;
      const played = key
        ? midiNumberToPitch(ev.note, key.fifths < 0)
        : wrongPitches([ev.note], [asked.pitch.midiNumber], [asked.pitch])[0];
      const { mixups, ladder, review, slices } = mineRef.current;
      const stats = recordAnswer(mineRef.current.stats, asked.id, correct, ms);
      const clef = settings.trainerClef;
      const was = ladder[clef] ?? landmarkCount(clef);
      const level = settings.trainerLadder ? ladderLevel(clef, stats, was) : was;
      if (level > was) setLadderNew(ladderOrder(clef)[level - 1]?.id ?? null);
      keep({
        ...mineRef.current,
        stats,
        today: recordDay(mineRef.current.today, localDay(), correct, ms),
        mixups: correct ? recordRight(mixups, asked.id) : recordMixUp(mixups, asked.id, pitchToDisplayName(played), localDay()),
        ladder: level > was ? { ...ladder, [clef]: level } : ladder,
        review: recordReview(review, asked.id, correct, ms, localDay()),
        slices: recordSlices(slices, sliceKeys(asked.pitch, asked.clef, key), correct, ms),
      });

      const name = pitchToDisplayName(asked.pitch);
      // #10262 "go from here to here": with names off the staff answers, not a letter.
      const names = settings.showNoteNames;
      if (correct) {
        setFeedback({ correct, line: names ? `You played ${name}` : ms === null ? '' : seconds(ms), wrong: [] });
      } else {
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
    if (!window.confirm('Clear your speed, hit rate, mix-ups and review days for every note?')) return;
    drillingRef.current = false;
    setDrilling(false);
    // Intervals keep their record: this is the Notes reset.
    keep({ ...EMPTY, intervals: mineRef.current.intervals });
  };

  const toggleDrill = () => {
    drillingRef.current = !drillingRef.current;
    setDrilling(drillingRef.current);
    setDrillDone(false);
    ask(false);
  };

  const day = mine?.today?.day === localDay() ? mine.today : null;
  const hitRate = day && day.attempts > 0 ? Math.round((day.hits / day.attempts) * 100) : null;
  const slowest = useMemo(() => slowestNotes(mine?.stats ?? {}, 5), [mine]);
  const slowSpots = useMemo(() => slowestSlices(mine?.slices ?? {}), [mine]);
  const mixUps = useMemo(() => liveMixUps(mine?.mixups ?? {}), [mine]);
  // The notes this setting can ask: the ladder's set, every spelling in Keys, else the white keys.
  const dueCount = useMemo(() => {
    if (!mine) return 0;
    const pool = trainerLadder
      ? ladderOrder(trainerClef).slice(0, ladderLevel(trainerClef, mine.stats, mine.ladder[trainerClef]))
      : notePool(trainerClef, trainerAccidentals);
    return dueNotes(pool, mine.review, localDay()).length;
  }, [mine, trainerClef, trainerAccidentals, trainerLadder]);
  const ladder = useMemo(() => {
    if (!trainerLadder) return null;
    const order = ladderOrder(trainerClef);
    const stats = mine?.stats ?? {};
    const level = ladderLevel(trainerClef, stats, mine?.ladder[trainerClef]);
    const name = (id: string) => id.replace(':', ' ').replace(/^(treble|bass) (.+)$/, trainerClef === 'both' ? '$2 $1' : '$2');
    return {
      level,
      of: order.length,
      learning: order.slice(0, level).filter((n) => !isKnown(stats[n.id])).map((n) => name(n.id)),
      next: level < order.length ? name(order[level].id) : null,
      added: ladderNew ? name(ladderNew) : null,
    };
  }, [mine, trainerLadder, trainerClef, ladderNew]);

  return (
    <div
      className="flex flex-col items-center gap-4 w-full"
      data-testid="note-trainer"
      data-note-id={current?.id}
      data-midi={current?.pitch.midiNumber}
      data-key={musicKey?.name}
      data-drilling={drilling ? '1' : undefined}
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
          <div data-testid="note-due" data-due={dueCount} className={`mt-1 ${dueCount ? 'text-amber-300' : 'text-gray-500'}`}>
            Due today: {dueCount}
          </div>
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
        {slowSpots.length > 0 && (
          <div data-testid="note-hesitation">
            <div className="text-gray-500 text-xs uppercase tracking-wider mb-1">Where you slow down</div>
            {slowSpots.map((h) => (
              <div key={h.key} className="flex gap-3 text-gray-200" data-testid="note-slow-spot" data-key={h.key}>
                <span className="w-44">{h.label}</span>
                <span className="w-12 font-mono">{seconds(h.avgMs)}</span>
                <span className="font-mono text-amber-300/80">+{seconds(h.overMs)}</span>
              </div>
            ))}
            {mine?.slices.all && (
              <div className="text-gray-500 text-xs mt-1">+ is slower than your usual {seconds(mine.slices.all.avgMs)} a note</div>
            )}
          </div>
        )}
        {ladder && (
          <div data-testid="note-ladder" data-level={ladder.level}>
            <div className="text-gray-500 text-xs uppercase tracking-wider mb-1">Ladder</div>
            <div className="text-gray-200">
              {ladder.level} of {ladder.of} notes
              {ladder.added && <span className="ml-2 text-emerald-400 font-semibold">+ {ladder.added}</span>}
            </div>
            {ladder.next ? (
              <div className="text-gray-400 text-xs mt-1 max-w-xs">
                Next: <span className="text-gray-200">{ladder.next}</span>, once{' '}
                {ladder.learning.length ? ladder.learning.join(', ') : 'these'} {ladder.learning.length === 1 ? 'is' : 'are'} right {LADDER_RUN} times
                running and under {LADDER_FAST_MS / 1000} s
              </div>
            ) : (
              <div className="text-emerald-400 text-xs mt-1">Every note is in</div>
            )}
          </div>
        )}
        <div data-testid="note-mixups">
          <div className="text-gray-500 text-xs uppercase tracking-wider mb-1">Your mix-ups</div>
          {mixUps.length === 0 && (
            <div className="text-gray-500">{drillDone ? 'All cleared' : 'None yet'}</div>
          )}
          {mixUps.slice(0, MIXUPS_SHOWN).map((m) => {
            const [clef, name] = m.asked.split(':');
            const why = mixUpLabel(mixUpKind(m.asked, m.played), clef as TrainerNote['clef']);
            return (
              <div key={`${m.asked}>${m.played}`} className="flex gap-3 text-gray-200" data-testid="note-mixup">
                <span className="w-24">
                  <span className="font-semibold">{name}</span> <span className="text-gray-400">{clef}</span>
                </span>
                <span className="w-24">
                  you played <span className="font-semibold">{m.played}</span>
                </span>
                <span className="w-8 font-mono text-gray-400">{m.count}×</span>
                {why && <span className="text-amber-300/80">{why}</span>}
              </div>
            );
          })}
          {(mixUps.length > 0 || drilling) && (
            <button
              onClick={toggleDrill}
              data-testid="note-mixup-drill"
              className="mt-2 text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-100"
            >
              {drilling ? 'Back to all notes' : 'Drill my mix-ups'}
            </button>
          )}
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
