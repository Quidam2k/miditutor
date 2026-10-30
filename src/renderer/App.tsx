import { useCallback, useEffect, useRef, useState } from 'react';
import { useMidi } from './components/midi/useMidi';
import { MidiStatus } from './components/midi/MidiStatus';
import { MidiMonitor } from './components/midi/MidiMonitor';
import { VirtualKeyboardDev } from './components/midi/VirtualKeyboardDev';
import { ExerciseView } from './components/exercise/ExerciseView';
import { ScoreView } from './components/score/ScoreView';
import { useTutorBridge } from './components/tutor/useTutorBridge';
import { RecordButton, PIANO_CREDIT } from './components/tutor/RecordButton';
import { TutorButton } from './components/tutor/TutorButton';
import { ReviewView } from './components/review/ReviewView';
import { TopClock } from './components/TopClock';
import { readStartupSnapshot } from './components/score/sessionSnapshot';
import { useSettingsStore } from './store/useSettingsStore';
import { useTutorStore } from './store/useTutorStore';

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
  // #10162: a restart reopens the tab he left (Review is desk-only, so not that one).
  const [view, setView] = useState<View>(() => {
    const last = useSettingsStore.getState().lastView;
    return last === 'monitor' || last === 'score' ? last : 'practice';
  });
  const setLastView = useSettingsStore((s) => s.setLastView);
  useEffect(() => setLastView(view), [view, setLastView]);
  const scoreLayout = useSettingsStore((s) => s.scoreLayout);
  const strip = view === 'score' && scoreLayout === 'strip';
  const mainWidth =
    view === 'review' ? 'max-w-7xl'
    : strip ? 'max-w-none min-h-0'
    : view === 'score' && scoreLayout === 'pages' ? 'max-w-none'
    : 'max-w-3xl';
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
  useEffect(() => {
    document.title = `MidiTutor ${__APP_VERSION__}`;
    void readStartupSnapshot();
  }, []);
  // #5259: a homework line opens its piece there too.
  const pieceRequested = useTutorStore((s) => s.pieceRequest !== null);
  useEffect(() => {
    if (pieceRequested) setView('score');
  }, [pieceRequested]);

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
      <header className="flex items-center justify-between gap-4 px-6 py-3 border-b border-gray-800/50">
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
        <TopClock />
        <div className="flex items-center gap-4">
          <TutorButton />
          <RecordButton />
          <MidiStatus />
        </div>
      </header>

      {/* Main content */}
      <main ref={mainRef} className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center p-6 gap-6">
        {/* Review puts a full-width scan line beside the score: it gets the wide column. */}
        {/* Pages side by side (#5137) and the strip (#5153) need the whole screen width; the
            strip also fits the screen's height, so it never scrolls the page. */}
        <div
          className={`w-full flex-1 ${mainWidth}`}
        >
          {view === 'practice' && <ExerciseView key={practiceVisit} />}
          {view === 'monitor' && <MidiMonitor />}
          {view === 'score' && <ScoreView />}
          {view === 'review' && <ReviewView />}
        </div>

        {/* DEV-ONLY virtual keyboard: exercise the app without hardware/loopMIDI.
            import.meta.env.DEV is false in packaged builds, so this never ships. */}
        {import.meta.env.DEV && !strip && (
          <div className="w-full max-w-3xl">
            <VirtualKeyboardDev />
          </div>
        )}
      </main>
      <footer className="flex justify-between gap-4 px-6 py-1 text-[10px] text-gray-600">
        <span>{PIANO_CREDIT}</span>
        {/* The title bar can't be seen in full screen. */}
        <span data-testid="app-version">MidiTutor {__APP_VERSION__}</span>
      </footer>
    </div>
  );
}
