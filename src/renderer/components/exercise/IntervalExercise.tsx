import { useEffect, useRef, useCallback, useState } from 'react';
import { StaffDisplay } from '../staff/StaffDisplay';
import { FeedbackOverlay } from '../feedback/FeedbackOverlay';
import { useExerciseStore } from '../../store/useExerciseStore';
import { useSessionStore } from '../../store/useSessionStore';
import { useMidiStore } from '../../store/useMidiStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { ExerciseEngine } from '../../engine/ExerciseEngine';
import { getIntervalName, pitchToDisplayName } from '../../engine/MusicTheory';
import { playChord, playCorrectSound, playWrongSound, initAudio, isInitialized } from '../../audio/AudioEngine';

const FEEDBACK_DURATION = 1200;

export function IntervalExercise() {
  const engineRef = useRef<ExerciseEngine | null>(null);
  const { currentExercise, lastResult, phase, playedNotes, presentedAt, setExercise, setResult, setPhase, addPlayedNote, clearPlayedNotes } =
    useExerciseStore();
  const { recordResult, startSession } = useSessionStore();
  const { lastNoteOn } = useMidiStore();
  const { clef, audioEnabled } = useSettingsStore();
  const [highlightColor, setHighlightColor] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const lastProcessedTimestamp = useRef<number>(0);

  if (!engineRef.current) {
    engineRef.current = new ExerciseEngine(clef, 'interval');
  }

  useEffect(() => {
    engineRef.current?.setClef(clef);
    engineRef.current?.setExerciseType('interval');
  }, [clef]);

  const nextExercise = useCallback(() => {
    setHighlightColor(null);
    clearPlayedNotes();
    const engine = engineRef.current!;
    const exercise = engine.generateExercise();
    setExercise(exercise);
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

  // Handle MIDI input — collect two notes
  useEffect(() => {
    if (!lastNoteOn) return;
    if (phase !== 'awaiting-input') return;
    if (!currentExercise) return;
    if (lastNoteOn.timestamp <= lastProcessedTimestamp.current) return;

    lastProcessedTimestamp.current = lastNoteOn.timestamp;
    addPlayedNote(lastNoteOn.note);
  }, [lastNoteOn, phase, currentExercise, addPlayedNote]);

  // Evaluate when we have enough notes
  useEffect(() => {
    if (phase !== 'awaiting-input') return;
    if (!currentExercise) return;
    if (playedNotes.length < currentExercise.expectedMidiNumbers.length) return;

    const responseTime = presentedAt ? Date.now() - presentedAt : 0;
    const engine = engineRef.current!;
    const result = engine.evaluate(currentExercise, playedNotes, responseTime);

    setResult(result);
    recordResult(result.correct);

    if (result.correct) {
      setHighlightColor('green');
      if (audioEnabled) playCorrectSound();
    } else {
      setHighlightColor('red');
      if (audioEnabled) {
        playWrongSound();
        setTimeout(() => {
          playChord(currentExercise.expectedMidiNumbers);
        }, 300);
      }
    }

    setTimeout(() => {
      nextExercise();
    }, FEEDBACK_DURATION);
  }, [playedNotes, phase, currentExercise, presentedAt, setResult, recordResult, audioEnabled, nextExercise]);

  if (!started) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-12">
        <h2 className="text-2xl font-bold text-white">Interval Identification</h2>
        <p className="text-gray-400 text-center max-w-md">
          Two notes will appear on the staff. Play both notes on your MIDI keyboard.
          Order doesn't matter.
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

  const intervalSemitones = currentExercise
    ? Math.abs(currentExercise.expectedMidiNumbers[1] - currentExercise.expectedMidiNumbers[0])
    : 0;

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      <div className="relative w-full max-w-2xl">
        <StaffDisplay
          notes={currentExercise?.prompt ?? []}
          clef={clef}
          highlightColor={highlightColor}
        />
        <FeedbackOverlay result={lastResult} visible={phase === 'feedback'} />
      </div>

      <div className="text-gray-500 text-sm">
        {phase === 'awaiting-input' && (
          <span>Play {currentExercise ? currentExercise.expectedMidiNumbers.length - playedNotes.length : 0} more note(s)</span>
        )}
        {phase === 'feedback' && currentExercise && (
          <span>
            {getIntervalName(intervalSemitones)}
            {' — '}
            {currentExercise.prompt.map(pitchToDisplayName).join(' to ')}
          </span>
        )}
      </div>
    </div>
  );
}
