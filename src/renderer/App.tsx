import { useCallback, useEffect, useRef, useState } from 'react';
import { useMidi } from './components/midi/useMidi';
import { MidiStatus } from './components/midi/MidiStatus';
import { MidiMonitor } from './components/midi/MidiMonitor';
import { VirtualKeyboardDev } from './components/midi/VirtualKeyboardDev';
import { ExerciseView } from './components/exercise/ExerciseView';
import { ScoreView } from './components/score/ScoreView';
import { useTutorBridge } from './components/tutor/useTutorBridge';
import { RecordButton, PIANO_CREDIT } from './components/tutor/RecordButton';
import { ReviewView } from './components/review/ReviewView';

type View = 'practice' | 'monitor' | 'score' | 'review';

const TABS: { id: View; label: string }[] = [
  { id: 'practice', label: 'Practice' },
  { id: 'monitor', label: 'MIDI Monitor' },
  { id: 'score', label: 'Score' },
];
// Scan review (#9664): only on the desk, when main was started with a review library.
const REVIEW_TAB = { id: 'review' as const, label: 'Review' };

export function App() {
  useMidi();
  const [view, setView] = useState<View>('practice');
  // Bumped on every click of Practice (or the title) so it always lands on the drill's start screen.
  const [practiceVisit, setPracticeVisit] = useState(0);
  const mainRef = useRef<HTMLElement>(null);
  const [reviewOn, setReviewOn] = useState(false);
  useEffect(() => {
    window.tutorBridge?.reviewInfo?.().then((info) => setReviewOn(info !== null), () => undefined);
  }, []);
  const tabs = reviewOn ? [...TABS, REVIEW_TAB] : TABS;
  // A persona pushing a task or piece brings the Score tab forward.
  useTutorBridge(useCallback(() => setView('score'), []));

  // Every tab click does something visible: switch, back to the top, and Practice restarts (#5058).
  const go = (next: View) => {
    if (next === 'practice') setPracticeVisit((n) => n + 1);
    setView(next);
    mainRef.current?.scrollTo({ top: 0 });
  };

  return (
    // The page itself never scrolls: <main> does, so the header (and its tabs) stay on screen
    // however far down a score he has gone (#5058).
    <div className="h-screen bg-gray-950 text-white flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-gray-800/50">
        <div className="flex items-center gap-6">
          <h1>
            <button
              onClick={() => go('practice')}
              title="Back to Practice"
              className="text-lg font-bold tracking-tight text-indigo-400 hover:text-indigo-300"
            >
              MidiTutor
            </button>
          </h1>
          <nav className="flex items-center gap-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => go(t.id)}
                className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                  view === t.id
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-400 hover:bg-gray-800/60 hover:text-gray-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <RecordButton />
          <MidiStatus />
        </div>
      </header>

      {/* Main content */}
      <main ref={mainRef} className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center p-6 gap-6">
        {/* Review puts a full-width scan line beside the score: it gets the wide column. */}
        <div className={`w-full flex-1 ${view === 'review' ? 'max-w-7xl' : 'max-w-3xl'}`}>
          {view === 'practice' && <ExerciseView key={practiceVisit} />}
          {view === 'monitor' && <MidiMonitor />}
          {view === 'score' && <ScoreView />}
          {view === 'review' && <ReviewView />}
        </div>

        {/* DEV-ONLY virtual keyboard: exercise the app without hardware/loopMIDI.
            import.meta.env.DEV is false in packaged builds, so this never ships. */}
        {import.meta.env.DEV && (
          <div className="w-full max-w-3xl">
            <VirtualKeyboardDev />
          </div>
        )}
      </main>
      <footer className="px-6 py-1 text-[10px] text-gray-600">{PIANO_CREDIT}</footer>
    </div>
  );
}
