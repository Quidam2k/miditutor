import { useEffect, useRef, useCallback, useState } from 'react';
import { StaffDisplay } from '../staff/StaffDisplay';
import { FeedbackOverlay } from '../feedback/FeedbackOverlay';
import { useExerciseStore } from '../../store/useExerciseStore';
import { useSessionStore } from '../../store/useSessionStore';
import { useMidiStore } from '../../store/useMidiStore';
import { useSettingsStore, localDay } from '../../store/useSettingsStore';
import { ExerciseEngine } from '../../engine/ExerciseEngine';
import { pitchToDisplayName, wrongPitches } from '../../engine/MusicTheory';
import { playChord, initAudio, isInitialized } from '../../audio/AudioEngine';

const FEEDBACK_DURATION = 1200;
/** JP's assignment: 10 correct a day. */
const DAILY_GOAL = 10;

export function IntervalExercise() {
  const engineRef = useRef<ExerciseEngine | null>(null);
  const { currentExercise, lastResult, phase, presentedAt, setExercise, setResult, setPhase, clearPlayedNotes } =
    useExerciseStore();
  const { recordResult, startSession } = useSessionStore();
  const held = useMidiStore((s) => s.held);
  const { clef, audioEnabled, showNoteNames, intervalGoal, countIntervalCorrect } = useSettingsStore();
  const [started, setStarted] = useState(false);
  // A miss counts once per interval; the interval stays up until he plays it right.
  const missedRef = useRef(false);

  if (!engineRef.current) {
    engineRef.current = new ExerciseEngine(clef, 'interval');
  }

  useEffect(() => {
    engineRef.current?.setClef(clef);
    engineRef.current?.setExerciseType('interval');
  }, [clef]);

  const nextExercise = useCallback(() => {
    missedRef.current = false;
    clearPlayedNotes();
    setExercise(engineRef.current!.generateExercise());
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

  // Subscribe to every note-on: two keys struck together can land in one React render,
  // and an effect on lastNoteOn would see only one.
  useEffect(() => {
    if (phase !== 'awaiting-input' || !currentExercise) return;
    const expected = currentExercise.expectedMidiNumbers;
    return useMidiStore.subscribe((state, prev) => {
      const ev = state.lastNoteOn;
      if (!ev || ev === prev.lastNoteOn) return;
      const store = useExerciseStore.getState();
      if (!expected.includes(ev.note)) {
        // Wrong key: start the pair over; it shows red only while he holds it (#5059).
        store.clearPlayedNotes();
        if (!missedRef.current) {
          missedRef.current = true;
          recordResult(false);
          if (audioEnabled) playChord(expected);
        }
        return;
      }
      if (!store.playedNotes.includes(ev.note)) store.addPlayedNote(ev.note);
      const played = useExerciseStore.getState().playedNotes;
      if (!expected.every((n) => played.includes(n))) return;
      const result = engineRef.current!.evaluate(currentExercise, played, presentedAt ? Date.now() - presentedAt : 0);
      setResult(result);
      if (!missedRef.current) {
        recordResult(true);
        countIntervalCorrect();
      }
      setTimeout(nextExercise, FEEDBACK_DURATION);
    });
  }, [phase, currentExercise, presentedAt, audioEnabled, recordResult, setResult, countIntervalCorrect, nextExercise]);

  // Wrong keys show only while held (#5059).
  const wrongNotes = currentExercise && phase === 'awaiting-input'
    ? wrongPitches(held, currentExercise.expectedMidiNumbers, currentExercise.prompt)
    : [];
  const todayCorrect = intervalGoal.day === localDay() ? intervalGoal.correct : 0;

  if (!started) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-12">
        <h2 className="text-2xl font-bold text-white">Intervals</h2>
        <p className="text-gray-300 text-center max-w-md">
          JP's interval set: minor 2nd up to the octave. Two notes appear on the staff; play both
          (together or one after the other). Goal: {DAILY_GOAL} right today.
        </p>
        <button
          onClick={startExercises}
          className="px-8 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-semibold text-lg transition-colors"
        >
          Start Practice
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 w-full">
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
        <FeedbackOverlay result={lastResult} visible={phase === 'feedback'} />
      </div>

      {currentExercise && (
        <div className="text-gray-200 text-lg font-semibold">
          {currentExercise.intervalName}
          {showNoteNames && <span className="text-gray-300 font-normal">: {currentExercise.prompt.map(pitchToDisplayName).join(' to ')}</span>}
        </div>
      )}
    </div>
  );
}
