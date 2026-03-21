import { useSettingsStore } from '../../store/useSettingsStore';
import { SessionStats } from '../feedback/SessionStats';
import { NoteExercise } from './NoteExercise';
import { IntervalExercise } from './IntervalExercise';

export function ExerciseView() {
  const { exerciseType, setExerciseType, clef, setClef, audioEnabled, setAudioEnabled, showNoteNames, setShowNoteNames } =
    useSettingsStore();

  return (
    <div className="flex flex-col items-center gap-6 w-full">
      {/* Settings bar */}
      <div className="flex flex-wrap gap-3 justify-center">
        <ToggleGroup
          label="Exercise"
          options={[
            { value: 'note-identification', label: 'Notes' },
            { value: 'interval', label: 'Intervals' },
          ]}
          selected={exerciseType}
          onChange={(v) => setExerciseType(v as 'note-identification' | 'interval')}
        />
        <ToggleGroup
          label="Clef"
          options={[
            { value: 'treble', label: 'Treble' },
            { value: 'bass', label: 'Bass' },
          ]}
          selected={clef}
          onChange={(v) => setClef(v as 'treble' | 'bass')}
        />
        <Toggle label="Audio" checked={audioEnabled} onChange={setAudioEnabled} />
        <Toggle label="Note Names" checked={showNoteNames} onChange={setShowNoteNames} />
      </div>

      {/* Exercise */}
      {exerciseType === 'note-identification' ? <NoteExercise /> : <IntervalExercise />}

      {/* Stats */}
      <SessionStats />
    </div>
  );
}

function ToggleGroup({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-gray-500 uppercase tracking-wider mr-1">{label}</span>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
            selected === opt.value
              ? 'bg-indigo-600 text-white'
              : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-sm font-medium transition-colors ${
        checked ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
      }`}
    >
      {label}
    </button>
  );
}
