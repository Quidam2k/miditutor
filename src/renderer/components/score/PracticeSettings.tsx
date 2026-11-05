// The practice preferences that don't earn a toolbar slot of their own: the graze filter
// (#5516), keep awake (#5522). All persist.
import { useState } from 'react';
import { useSettingsStore } from '../../store/useSettingsStore';

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
  const s = useSettingsStore();
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className={btn} data-testid="practice-settings">
        ⚙ Practice
      </button>
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
          <label
            className="flex items-center gap-1.5"
            title="Keep the screen from going dark while you play (your piano's keys don't count as activity to the Mac). Lets go 15 minutes after your last note."
          >
            <input type="checkbox" checked={s.keepAwake} onChange={(e) => s.setPrefs({ keepAwake: e.target.checked })} data-testid="keep-awake" />
            Keep screen awake while playing
          </label>
        </div>
      )}
    </div>
  );
}
