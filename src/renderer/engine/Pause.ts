// #5948 / #6053: Pause. While on, every note he strikes is ignored by whatever screen is judging
// (Score, Notes, Intervals, homework): no wrong count, no miss sound, no stats, no cursor move.
// It is easy to forget, so it lets go by itself after PAUSE_MAX_MS.
export const PAUSE_MAX_MS = 10 * 60 * 1000;

/** True while a pause started at `pausedAt` (ms; null = not paused) still holds at `now`. */
export const pauseHolds = (pausedAt: number | null, now: number): boolean =>
  pausedAt !== null && now - pausedAt < PAUSE_MAX_MS;
