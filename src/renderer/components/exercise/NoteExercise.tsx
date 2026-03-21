import { useEffect, useRef, useCallback, useState } from 'react';
import { StaffDisplay } from '../staff/StaffDisplay';
import { FeedbackOverlay } from '../feedback/FeedbackOverlay';
import { useExerciseStore } from '../../store/useExerciseStore';
import { useSessionStore } from '../../store/useSessionStore';
import { useMidiStore } from '../../store/useMidiStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { ExerciseEngine } from '../../engine/ExerciseEngine';
import { pitchToDisplayName } from '../../engine/MusicTheory';
import { playNote, playCorrectSound, playWrongSound, initAudio, isInitialized } from '../../audio/AudioEngine';

const FEEDBACK_DURATION = 800;

export function NoteExercise() {
  const engineRef = useRef<ExerciseEngine | null>(null);
  const { currentExercise, lastResult, phase, presentedAt, setExercise, setResult, setPhase } =
    useExerciseStore();
  const { recordResult, startSession } = useSessionStore();
  const { lastNoteOn } = useMidiStore();
  const { clef, audioEnabled, showNoteNames } = useSettingsStore();
  const [highlightColor, setHighlightColor] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const lastProcessedTimestamp = useRef<number>(0);

  // Initialize engine
  if (!engineRef.current) {
    engineRef.current = new ExerciseEngine(clef, 'note-identification');
  }

  // Update engine when settings change
  useEffect(() => {
    engineRef.current?.setClef(clef);
  }, [clef]);

  const nextExercise = useCallback(() => {
    setHighlightColor(null);
    const engine = engineRef.current!;
    const exercise = engine.generateExercise();
    setExercise(exercise);
    setPhase('awaiting-input');
  }, [setExercise, setPhase]);

  const startExercises = useCallback(async () => {
    if (!isInitialized()) {
      await initAudio();
    }
    startSession();
    setStarted(true);
    nextExercise();
  }, [nextExercise, startSession]);

  // Handle MIDI input
  useEffect(() => {
    if (!lastNoteOn) return;
    if (phase !== 'awaiting-input') return;
    if (!currentExercise) return;
    if (lastNoteOn.timestamp <= lastProcessedTimestamp.current) return;

    lastProcessedTimestamp.current = lastNoteOn.timestamp;

    const responseTime = presentedAt ? Date.now() - presentedAt : 0;
    const engine = engineRef.current!;
    const result = engine.evaluate(currentExercise, [lastNoteOn.note], responseTime);

    setResult(result);
    recordResult(result.correct);

    if (result.correct) {
      setHighlightColor('green');
      if (audioEnabled) playCorrectSound();
    } else {
      setHighlightColor('red');
      if (audioEnabled) {
        playWrongSound();
        // Play the correct note so student can hear it
        setTimeout(() => {
          playNote(currentExercise.expectedMidiNumbers[0]);
        }, 300);
      }
    }

    // Move to next exercise after feedback duration
    setTimeout(() => {
      nextExercise();
    }, FEEDBACK_DURATION);
  }, [lastNoteOn, phase, currentExercise, presentedAt, setResult, recordResult, audioEnabled, nextExercise]);

  if (!started) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-12">
        <h2 className="text-2xl font-bold text-white">Note Identification</h2>
        <p className="text-gray-400 text-center max-w-md">
          A note will appear on the staff. Play the matching key on your MIDI keyboard.
          The difficulty increases as you master each note.
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

  const difficulty = engineRef.current!.getDifficulty();

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

      {showNoteNames && currentExercise && phase === 'feedback' && (
        <div className="text-gray-400 text-sm">
          {currentExercise.prompt.map(pitchToDisplayName).join(', ')}
        </div>
      )}

      <div className="flex gap-4 text-xs text-gray-600">
        <span>Range: MIDI {difficulty.rangeLow}–{difficulty.rangeHigh}</span>
        {difficulty.accidentals && <span>Accidentals: On</span>}
      </div>
    </div>
  );
}
