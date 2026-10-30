import { useEffect, useRef, useState } from 'react';
import { useMidiStore } from '../store/useMidiStore';
import { parseTally, practiceLabel, tallyNote } from '../engine/PracticeTally';

const STORE_KEY = 'miditutor-practice';
const SAVE_EVERY_MS = 15000;

// #10240: the date and time in the middle of the top bar, so he can see them in full screen,
// and how long he has practiced. The count only moves when he plays, and survives a relaunch.
export function TopClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const [tally, setTally] = useState(() => parseTally(localStorage.getItem(STORE_KEY)));
  const tallyRef = useRef(tally);
  useEffect(() => {
    let savedAt = 0;
    const save = () => localStorage.setItem(STORE_KEY, JSON.stringify(tallyRef.current));
    const unsub = useMidiStore.subscribe((state, prev) => {
      if (!state.lastNoteOn || state.lastNoteOn === prev.lastNoteOn) return;
      // A note the tutor injected isn't him playing.
      if (state.noteLog[0]?.source === 'inject') return;
      const at = Date.now();
      tallyRef.current = tallyNote(tallyRef.current, at);
      setTally(tallyRef.current);
      if (at - savedAt > SAVE_EVERY_MS) {
        savedAt = at;
        save();
      }
    });
    window.addEventListener('beforeunload', save);
    return () => {
      unsub();
      window.removeEventListener('beforeunload', save);
    };
  }, []);

  const date = now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const time = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return (
    <div className="flex min-w-0 items-center gap-3 whitespace-nowrap text-sm text-gray-300" data-testid="top-clock">
      <span data-testid="clock-now">{date} · {time}</span>
      {tally && (
        <span className="text-gray-400" title="Practice time: from your first note, leaving out gaps over 10 minutes" data-testid="practice-count">
          Practiced <span className="font-mono text-gray-200">{practiceLabel(tally.totalMs)}</span>
        </span>
      )}
    </div>
  );
}
