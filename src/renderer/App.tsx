import { useState } from 'react';
import { useMidi } from './components/midi/useMidi';
import { MidiStatus } from './components/midi/MidiStatus';
import { MidiMonitor } from './components/midi/MidiMonitor';
import { VirtualKeyboardDev } from './components/midi/VirtualKeyboardDev';
import { ExerciseView } from './components/exercise/ExerciseView';
import { ScoreView } from './components/score/ScoreView';

type View = 'practice' | 'monitor' | 'score';

const TABS: { id: View; label: string }[] = [
  { id: 'practice', label: 'Practice' },
  { id: 'monitor', label: 'MIDI Monitor' },
  { id: 'score', label: 'Score' },
];

export function App() {
  useMidi();
  const [view, setView] = useState<View>('practice');

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-gray-800/50">
        <div className="flex items-center gap-6">
          <h1 className="text-lg font-bold tracking-tight text-indigo-400">MidiTutor</h1>
          <nav className="flex items-center gap-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setView(t.id)}
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
        <MidiStatus />
      </header>

      {/* Main content */}
      <main className="flex-1 flex flex-col items-center p-6 gap-6">
        <div className="w-full max-w-3xl flex-1">
          {view === 'practice' && <ExerciseView />}
          {view === 'monitor' && <MidiMonitor />}
          {view === 'score' && <ScoreView />}
        </div>

        {/* DEV-ONLY virtual keyboard: exercise the app without hardware/loopMIDI.
            import.meta.env.DEV is false in packaged builds, so this never ships. */}
        {import.meta.env.DEV && (
          <div className="w-full max-w-3xl">
            <VirtualKeyboardDev />
          </div>
        )}
      </main>
    </div>
  );
}
