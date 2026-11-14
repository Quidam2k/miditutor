// The practice preferences that don't earn a toolbar slot of their own: the graze filter
// (#5516), keep awake (#5522), clean-run celebrations (#5521). All persist.
import { useState } from 'react';
import { useSettingsStore, type PrefKey } from '../../store/useSettingsStore';
import { LessonNotes } from './LessonNotes';

type Toggle = Exclude<PrefKey, 'grazeMs' | 'minVelocity' | 'trainingWheels' | 'eyesUp' | 'eyesUpMs' | 'missVolume'>; // #6047

function Check({ k, label, title }: { k: Toggle; label: string; title: string }) {
  const on = useSettingsStore((s) => s[k]);
  return (
    <label className="flex items-center gap-1.5" title={title}>
      <input type="checkbox" checked={on} onChange={(e) => useSettingsStore.getState().setPrefs({ [k]: e.target.checked })} data-testid={k} />
      {label}
    </label>
  );
}

function Num({ label, title, value, max, onChange, testId }: {
  label: string; title: string; value: number; max: number; onChange: (n: number) => void; testId: string;
}) {
  return (
    <label className="flex items-center justify-between gap-3" title={title}>
      {label}
      <input
        type="number"
        min={0}
        max={max}
        value={value}
        onChange={(e) => {
          const n = Math.trunc(Number(e.target.value));
          if (Number.isFinite(n)) onChange(Math.max(0, Math.min(max, n)));
        }}
        className="w-16 rounded bg-gray-800 px-1 text-right font-mono text-gray-100"
        data-testid={testId}
      />
    </label>
  );
}

export function PracticeSettings({ btn }: { btn: string }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(false); // #6112
  const s = useSettingsStore();
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className={btn} data-testid="practice-settings">
        ⚙ Practice
      </button>
      {notes && <LessonNotes onClose={() => setNotes(false)} />}
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 flex w-64 flex-col gap-2 rounded-md border border-gray-700 bg-gray-900 p-3 text-sm text-gray-300 shadow-lg">
          <Num
            label="Graze window (ms)"
            title="A key struck this soon after you finish a note, that isn't part of it, is a graze: it doesn't count and the lap isn't clean. 0 = off."
            value={s.grazeMs}
            max={300}
            onChange={(n) => s.setPrefs({ grazeMs: n })}
            testId="graze-ms"
          />
          <Num
            label="Min velocity"
            title="Keys struck softer than this don't count and spoil a clean lap. 0 = off."
            value={s.minVelocity}
            max={127}
            onChange={(n) => s.setPrefs({ minVelocity: n })}
            testId="min-velocity"
          />
          <Check
            k="keepAwake"
            label="Keep screen awake while playing"
            title="Keep the screen from going dark while you play (your piano's keys don't count as activity to the Mac). Lets go 15 minutes after your last note."
          />
          <Check
            k="hintsOffNew"
            label="Hints off for new pieces"
            title="Fresh tunes and Sight-read pieces start with no green keys, little staff or note names. A wrong note (or, with Training wheels on, a long pause) brings them back until your next right one."
          />
          <Check
            k="keyFirst"
            label="Key first"
            title="Before a fresh tune or Sight-read piece starts, play the key signature's sharps or flats (any octave, any order), so you've worked out the key before the first note. Also in Practice > Notes with Keys on."
          />
          <Check
            k="wristReminder"
            label="Wrist reminder"
            title="Off by default. When on, one quiet line on screen reminds you to check your wrists and hand position: at the start of a rep (a lap of your loop, or the piece once), at its end after your hands are still for 2 seconds, or after a minute with no notes. One line per pause. Never while you are playing; no sound."
          />
          <button
            onClick={() => { setNotes(true); setOpen(false); }}
            className="rounded bg-gray-800 px-2 py-1 text-left hover:bg-gray-700"
            title="Read what each piano lesson covered (read only)"
            data-testid="lesson-notes-open"
          >
            Lesson notes…
          </button>
          <div className="mt-1 border-t border-gray-700 pt-2 text-xs uppercase tracking-wide text-gray-500">Keep going</div>
          <Check k="keepClick" label="Click on the beat" title="Keep going plays a click on every beat (higher on the first beat of the bar), like a metronome at your back" />
          <Check
            k="keepStepUp"
            label="Speed up 4 after a good lap"
            title="After a Keep going lap with 9 in 10 notes right and few wrong ones, the next lap goes 4 clicks faster (JP: go up in 4s), never past the piece's target tempo"
          />
          <div className="mt-1 border-t border-gray-700 pt-2 text-xs uppercase tracking-wide text-gray-500">Clean laps</div>
          <Check k="celebrateChime" label="Chime" title="A soft ding from the computer when you finish a lap with no wrong notes" />
          <Check k="celebrateWave" label="Glow wave" title="The notes of the loop glow softly, left to right, after a clean lap" />
          <Check
            k="celebrateFinale"
            label="Finale"
            title="When Build backwards reaches its target: a fanfare that grows with how many bars you built"
          />
        </div>
      )}
    </div>
  );
}
