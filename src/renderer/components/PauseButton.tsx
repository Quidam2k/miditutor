import { useEffect } from 'react';
import { useMidiStore } from '../store/useMidiStore';
import { PAUSE_MAX_MS } from '../engine/Pause';

// #5948 / #6053 (Todd: "I want a pause button on everything"): one button in the header, so it is on
// every screen, and a banner so it cannot be forgotten. Plain clicks only (trackball).
export function PauseButton() {
  const paused = useMidiStore((s) => s.pausedAt !== null);
  const setPaused = useMidiStore((s) => s.setPaused);
  return (
    <button
      onClick={() => setPaused(!paused)}
      title={paused ? 'Start judging your playing again' : 'Ignore everything you play until you press this again: no mistakes, no sounds, no stats'}
      className={`rounded-md px-3 py-1 text-sm font-medium ${paused ? 'bg-amber-500 text-black' : 'bg-gray-800 text-gray-200 hover:bg-gray-700'}`}
      data-testid="pause-button"
    >
      {paused ? '▶ Resume' : '⏸ Pause'}
    </button>
  );
}

export function PauseBanner() {
  const pausedAt = useMidiStore((s) => s.pausedAt);
  const setPaused = useMidiStore((s) => s.setPaused);
  useEffect(() => {
    if (pausedAt === null) return;
    const timer = window.setTimeout(() => useMidiStore.getState().setPaused(false), Math.max(0, pausedAt + PAUSE_MAX_MS - Date.now()));
    return () => window.clearTimeout(timer);
  }, [pausedAt]);
  if (pausedAt === null) return null;
  return (
    <div className="flex items-center justify-center gap-3 bg-amber-500/20 px-6 py-1 text-sm text-amber-200" data-testid="pause-banner">
      <span>
        ⏸ Paused: what you play is ignored (no mistakes, no sounds, no stats). It lets go by itself after {PAUSE_MAX_MS / 60000} minutes, or when you change screen or piece or press Restart.
      </span>
      <button onClick={() => setPaused(false)} className="rounded bg-amber-500 px-2 py-0.5 font-medium text-black" data-testid="pause-resume">
        Resume
      </button>
    </div>
  );
}
