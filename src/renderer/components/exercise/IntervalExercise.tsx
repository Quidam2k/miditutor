import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { StaffDisplay } from '../staff/StaffDisplay';
import { FeedbackOverlay } from '../feedback/FeedbackOverlay';
import { useExerciseStore } from '../../store/useExerciseStore';
import { useSessionStore } from '../../store/useSessionStore';
import { useMidiStore } from '../../store/useMidiStore';
import { useSettingsStore, localDay } from '../../store/useSettingsStore';
import { EMPTY_RECORD, TrainerRecord, readRecord, saveRecord } from '../../store/noteRecord';
import { ExerciseEngine } from '../../engine/ExerciseEngine';
import { hardestIntervals, intervalId, pickInterval } from '../../engine/IntervalCards';
import { recordAnswer } from '../../engine/NoteTrainer';
import { JP_INTERVALS, pitchToDisplayName, wrongPitches } from '../../engine/MusicTheory';
import { playChord, initAudio, isInitialized } from '../../audio/AudioEngine';

const FEEDBACK_DURATION = 1200;
/** After a wrong name the right one stays lit a little longer. */
const MISSED_NAME_DURATION = 2000;
/** JP's assignment: 10 correct a day. */
const DAILY_GOAL = 10;

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export function IntervalExercise() {
  const engineRef = useRef<ExerciseEngine | null>(null);
  const { currentExercise, lastResult, phase, presentedAt, setExercise, setResult, setPhase, clearPlayedNotes } =
    useExerciseStore();
  const { recordResult, startSession } = useSessionStore();
  const held = useMidiStore((s) => s.held);
  const { clef, audioEnabled, showNoteNames, intervalGoal, countIntervalCorrect, intervalNameIt } = useSettingsStore();
  const [started, setStarted] = useState(false);
  // A miss (wrong key or wrong name) counts once per interval; the card stays until he plays it right.
  const missedRef = useRef(false);
  // #5652 J "Name it": the name he picked, and whether that part is done (right, or shown after a miss).
  const [picked, setPicked] = useState<string | null>(null);
  const nameDoneRef = useRef(false);
  const playedAllRef = useRef(false);
  const finishedRef = useRef(false);
  const mineRef = useRef<TrainerRecord>(EMPTY_RECORD);
  const [mine, setMine] = useState<TrainerRecord | null>(null);

  if (!engineRef.current) {
    engineRef.current = new ExerciseEngine(clef, 'interval');
  }

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

  useEffect(() => {
    engineRef.current?.setClef(clef);
    engineRef.current?.setExerciseType('interval');
  }, [clef]);

  const nextExercise = useCallback(() => {
    missedRef.current = false;
    playedAllRef.current = false;
    finishedRef.current = false;
    nameDoneRef.current = !useSettingsStore.getState().intervalNameIt;
    setPicked(null);
    clearPlayedNotes();
    const c = useSettingsStore.getState().clef;
    const last = useExerciseStore.getState().currentExercise?.intervalShort;
    setExercise(engineRef.current!.generateExercise(pickInterval(c, mineRef.current.intervals, last)));
    setPhase('awaiting-input');
  }, [setExercise, setPhase, clearPlayedNotes]);

  const startExercises = useCallback(async () => {
    if (!isInitialized()) {
      await initAudio();
    }
    startSession();
    setStarted(true);
    nextExercise();
  }, [nextExercise, startSession]);

  const miss = useCallback(() => {
    if (missedRef.current) return;
    missedRef.current = true;
    recordResult(false);
  }, [recordResult]);

  /** Both notes played and (with Name it) the name settled: score the card and move on. */
  const finish = useCallback(() => {
    const ex = useExerciseStore.getState().currentExercise;
    if (!ex || finishedRef.current || !playedAllRef.current || !nameDoneRef.current) return;
    finishedRef.current = true;
    const played = useExerciseStore.getState().playedNotes;
    const at = useExerciseStore.getState().presentedAt;
    const ms = at ? Date.now() - at : 0;
    setResult(engineRef.current!.evaluate(ex, played, ms));
    const correct = !missedRef.current;
    if (correct) {
      recordResult(true);
      countIntervalCorrect();
    }
    if (ex.intervalShort) {
      const next = { ...mineRef.current, intervals: recordAnswer(mineRef.current.intervals, intervalId(ex.clef, ex.intervalShort), correct, correct ? ms : null) };
      mineRef.current = next;
      setMine(next);
      saveRecord(next);
    }
    setTimeout(nextExercise, correct ? FEEDBACK_DURATION : MISSED_NAME_DURATION);
  }, [setResult, recordResult, countIntervalCorrect, nextExercise]);

  // Name it switched off mid-card: the name part is done, and the card may already be played.
  useEffect(() => {
    if (intervalNameIt) return;
    nameDoneRef.current = true;
    finish();
  }, [intervalNameIt, finish]);

  // #5948: time spent paused is not thinking time: the clock restarts when he resumes.
  useEffect(
    () => useMidiStore.subscribe((s, p) => {
      if (p.pausedAt !== null && s.pausedAt === null) useExerciseStore.setState({ presentedAt: Date.now() });
    }),
    [],
  );

  // Subscribe to every note-on: two keys struck together can land in one React render,
  // and an effect on lastNoteOn would see only one.
  useEffect(() => {
    if (phase !== 'awaiting-input' || !currentExercise) return;
    const expected = currentExercise.expectedMidiNumbers;
    return useMidiStore.subscribe((state, prev) => {
      const ev = state.lastNoteOn;
      if (!ev || ev === prev.lastNoteOn || finishedRef.current) return;
      const store = useExerciseStore.getState();
      if (playedAllRef.current) return;
      if (!expected.includes(ev.note)) {
        // Wrong key: start the pair over; it shows red only while he holds it (#5059).
        store.clearPlayedNotes();
        if (!missedRef.current && audioEnabled) playChord(expected);
        miss();
        return;
      }
      if (!store.playedNotes.includes(ev.note)) store.addPlayedNote(ev.note);
      const played = useExerciseStore.getState().playedNotes;
      if (!expected.every((n) => played.includes(n))) return;
      playedAllRef.current = true;
      finish();
    });
  }, [phase, currentExercise, audioEnabled, miss, finish]);

  const name = (short: string) => {
    if (nameDoneRef.current || !currentExercise) return;
    setPicked(short);
    if (short !== currentExercise.intervalShort) miss();
    // Right or wrong, the name is settled: after a miss the right one is lit and he plays on.
    nameDoneRef.current = true;
    finish();
  };

  // Wrong keys show only while held (#5059).
  const wrongNotes = currentExercise && phase === 'awaiting-input'
    ? wrongPitches(held, currentExercise.expectedMidiNumbers, currentExercise.prompt)
    : [];
  const todayCorrect = intervalGoal.day === localDay() ? intervalGoal.correct : 0;
  const hardest = useMemo(() => hardestIntervals(clef, mine?.intervals ?? {}), [clef, mine]);
  const answerShort = currentExercise?.intervalShort;
  const nameWrong = picked !== null && picked !== answerShort;
  const showName = !intervalNameIt || picked !== null || phase === 'feedback';

  if (!started) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-12">
        <h2 className="text-2xl font-bold text-white">Intervals</h2>
        <p className="text-gray-300 text-center max-w-md">
          JP's interval set: minor 2nd up to the octave. Two notes appear on the staff; play both
          (together or one after the other){intervalNameIt ? ' and pick its name' : ''}. Goal: {DAILY_GOAL} right today.
        </p>
        <button
          onClick={startExercises}
          // Nothing is asked before the record is read, or a save would overwrite it with one answer.
          disabled={mine === null}
          className="disabled:opacity-50 px-8 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-semibold text-lg transition-colors"
        >
          Start Practice
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 w-full" data-testid="interval-trainer" data-interval={answerShort} data-midi={currentExercise?.expectedMidiNumbers.join(',')} data-phase={phase}>
      <div className={`text-sm font-medium ${todayCorrect >= DAILY_GOAL ? 'text-emerald-400' : 'text-gray-300'}`}>
        {todayCorrect} / {DAILY_GOAL} right today
      </div>

      <div className="relative w-full max-w-2xl">
        <StaffDisplay
          notes={currentExercise?.prompt ?? []}
          clef={clef}
          // Green when he gets it, and while a wrong key is down so he can see the target beside it.
          highlightColor={phase === 'feedback' || wrongNotes.length > 0 ? 'green' : null}
          wrongNotes={wrongNotes}
        />
        <FeedbackOverlay result={lastResult} visible={phase === 'feedback' && !nameWrong} />
      </div>

      {currentExercise && (
        <div className="h-7 text-gray-200 text-lg font-semibold" data-testid="interval-name">
          {showName && currentExercise.intervalName}
          {showNoteNames && <span className="text-gray-300 font-normal">{showName ? ': ' : ''}{currentExercise.prompt.map(pitchToDisplayName).join(' to ')}</span>}
        </div>
      )}

      {intervalNameIt && currentExercise && (
        <div className="flex flex-wrap justify-center gap-1.5 max-w-3xl" data-testid="interval-names">
          {JP_INTERVALS.map((i) => {
            const isAnswer = i.short === answerShort && picked !== null;
            const isWrong = i.short === picked && nameWrong;
            return (
              <button
                key={i.short}
                title={i.name}
                data-short={i.short}
                onClick={() => name(i.short)}
                className={`w-12 py-1.5 rounded font-mono text-sm ${
                  isAnswer ? 'bg-emerald-600 text-white' : isWrong ? 'bg-red-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-100'
                }`}
              >
                {i.short}
              </button>
            );
          })}
        </div>
      )}

      <div className="text-sm" data-testid="interval-hardest">
        <div className="text-gray-500 text-xs uppercase tracking-wider mb-1 text-center">Your hardest intervals, {clef}</div>
        {hardest.length === 0 && <div className="text-gray-500 text-center">A few more tries to see them</div>}
        {hardest.map((h) => (
          <div key={h.short} className="flex gap-3 text-gray-200" data-testid="interval-hard" data-short={h.short}>
            <span className="w-32">{h.name}</span>
            <span className="w-20 font-mono text-gray-400">{Math.round(h.hitRate * 100)}% right</span>
            <span className="w-12 font-mono">{h.avgMs === null ? '' : seconds(h.avgMs)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
