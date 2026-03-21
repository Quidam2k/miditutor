import { useMidi } from './components/midi/useMidi';
import { MidiStatus } from './components/midi/MidiStatus';
import { ExerciseView } from './components/exercise/ExerciseView';

export function App() {
  useMidi();

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-gray-800/50">
        <h1 className="text-lg font-bold tracking-tight text-indigo-400">MidiTutor</h1>
        <MidiStatus />
      </header>

      {/* Main content */}
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-3xl">
          <ExerciseView />
        </div>
      </main>
    </div>
  );
}
