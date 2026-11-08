import { useSettingsStore } from '../../store/useSettingsStore';
import { SessionStats } from '../feedback/SessionStats';
import { NoteExercise } from './NoteExercise';
import { IntervalExercise } from './IntervalExercise';
import { HomeworkExercise } from './HomeworkExercise';
import { ExerciseType } from '../../types/exercise';
import type { TrainerClef } from '../../engine/NoteTrainer';

export function ExerciseView() {
  const {
    exerciseType, setExerciseType, clef, setClef, audioEnabled, setAudioEnabled, showNoteNames, setShowNoteNames,
    trainerClef, setTrainerClef, trainerAccidentals, setTrainerAccidentals, trainerLadder, setTrainerLadder,
    intervalNameIt, setIntervalNameIt, keyFirst, setPrefs,
  } = useSettingsStore();

  return (
    <div className="flex flex-col items-center gap-6 w-full">
      {/* Settings bar */}
      <div className="flex flex-wrap gap-3 justify-center">
        <ToggleGroup
          label="Exercise"
          options={[
            { value: 'note-identification', label: 'Notes' },
            { value: 'interval', label: 'Intervals' },
            { value: 'homework', label: 'Homework' },
          ]}
          selected={exerciseType}
          onChange={(v) => setExerciseType(v as ExerciseType)}
        />
        {exerciseType !== 'homework' && (
          <>
            {exerciseType === 'note-identification' ? (
              <>
                <ToggleGroup
                  label="Clef"
                  options={[
                    { value: 'treble', label: 'Treble' },
                    { value: 'bass', label: 'Bass' },
                    { value: 'both', label: 'Both' },
                  ]}
                  selected={trainerClef}
                  onChange={(v) => setTrainerClef(v as TrainerClef)}
                />
                <Toggle
                  label="Keys"
                  title="On: a random key signature, and notes flagged only when the key needs it. Off: C major, white keys only."
                  checked={trainerAccidentals}
                  onChange={setTrainerAccidentals}
                />
                <Toggle
                  label="Key first"
                  title="With Keys on: each new key's sharps or flats are played first (any octave, any order) before its first note shows. JP 10/9: work the key out before you read."
                  checked={keyFirst}
                  onChange={(on) => setPrefs({ keyFirst: on })}
                />
                <Toggle
                  label="Ladder"
                  title="Starts on the landmark notes (middle C, treble G, bass F, the Cs a space away) and adds the next-nearest note once each note in play is right 3 times running and under 3 s. White keys, no key signature."
                  checked={trainerLadder}
                  onChange={setTrainerLadder}
                />
              </>
            ) : (
              <>
                <ToggleGroup
                  label="Clef"
                  options={[
                    { value: 'treble', label: 'Treble' },
                    { value: 'bass', label: 'Bass' },
                  ]}
                  selected={clef}
                  onChange={(v) => setClef(v as 'treble' | 'bass')}
                />
                <Toggle
                  label="Name it"
                  title="JP's 'require quality': the interval's name is hidden and you pick it (m3, P5...) as well as playing both notes. Off: the name is shown and you just play it."
                  checked={intervalNameIt}
                  onChange={setIntervalNameIt}
                />
              </>
            )}
            <Toggle
              label="Audio"
              title="Off: the tutor makes no sound. On: after a miss it plays the right notes so you can hear them."
              checked={audioEnabled}
              onChange={setAudioEnabled}
            />
            <Toggle
              label="Note names"
              title="Shows the letter names (like C4, E4) under the staff as a hint."
              checked={showNoteNames}
              onChange={setShowNoteNames}
            />
          </>
        )}
      </div>

      {/* Exercise */}
      {exerciseType === 'note-identification' && <NoteExercise />}
      {exerciseType === 'interval' && <IntervalExercise />}
      {exerciseType === 'homework' && <HomeworkExercise />}

      {/* Stats */}
      {exerciseType === 'interval' && <SessionStats />}
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
  title,
  checked,
  onChange,
}: {
  label: string;
  title: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      title={title}
      onClick={() => onChange(!checked)}
      className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-sm font-medium transition-colors ${
        checked ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
      }`}
    >
      {label}: {checked ? 'on' : 'off'}
    </button>
  );
}
