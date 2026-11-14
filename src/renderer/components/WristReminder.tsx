// #6105: the opt-in wrist reminder. Text only, no sound; never while keys are moving.
import { useEffect, useState } from 'react';
import { useMidiStore } from '../store/useMidiStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { shouldRemind } from '../engine/WristReminder';

export function WristReminder() {
  const on = useSettingsStore((s) => s.wristReminder);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    setShown(false);
    if (!on) return; // off: no timer, no subscription
    let lastNoteAt: number | null = null;
    let done = false; // already shown for this pause
    const unsubscribe = useMidiStore.subscribe((state, prev) => {
      if (state.noteLog[0]?.id === prev.noteLog[0]?.id) return;
      lastNoteAt = Date.now();
      done = false;
      setShown(false); // the next note puts it away
    });
    const timer = setInterval(() => {
      const holding = useMidiStore.getState().held.size > 0;
      if (shouldRemind({ on, now: Date.now(), lastNoteAt, holding, shown: done })) {
        done = true;
        setShown(true);
      }
    }, 1000);
    return () => {
      unsubscribe();
      clearInterval(timer);
      setShown(false);
    };
  }, [on]);

  if (!on || !shown) return null;
  return (
    <div
      className="pointer-events-auto fixed bottom-4 left-1/2 z-30 -translate-x-1/2 cursor-pointer rounded-md border border-gray-600 bg-gray-800/95 px-4 py-2 text-sm text-gray-200 shadow-lg"
      onClick={() => setShown(false)}
      data-testid="wrist-reminder"
    >
      Check your wrists and hand position.
    </div>
  );
}
