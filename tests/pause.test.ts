import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMidiStore } from '../src/renderer/store/useMidiStore';
import { PAUSE_MAX_MS, pauseHolds } from '../src/renderer/engine/Pause';

const strike = (note: number, kind: 'noteon' | 'noteoff' = 'noteon') =>
  useMidiStore.getState().ingestNote({ kind, note, velocity: kind === 'noteon' ? 80 : 0, channel: 1, source: 'hardware' });

afterEach(() => {
  vi.useRealTimers();
  useMidiStore.setState({ pausedAt: null, lastNoteOn: null, held: new Set(), noteLog: [] });
});

describe('Pause (#5948 #6053)', () => {
  it('a paused note is logged for the tutor feed but never reaches a judge', () => {
    useMidiStore.getState().setPaused(true);
    strike(61);
    const s = useMidiStore.getState();
    expect(s.lastNoteOn).toBeNull();
    expect(s.held.size).toBe(0);
    expect(s.noteLog).toHaveLength(1);
  });

  it('resuming judges again', () => {
    useMidiStore.getState().setPaused(true);
    strike(61);
    useMidiStore.getState().setPaused(false);
    strike(62);
    expect(useMidiStore.getState().lastNoteOn?.note).toBe(62);
    expect(useMidiStore.getState().held.has(62)).toBe(true);
  });

  it('lets go by itself after the limit and judges that very note', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    useMidiStore.getState().setPaused(true);
    vi.setSystemTime(1_000_000 + PAUSE_MAX_MS - 1);
    strike(60);
    expect(useMidiStore.getState().lastNoteOn).toBeNull();
    vi.setSystemTime(1_000_000 + PAUSE_MAX_MS);
    strike(64);
    expect(useMidiStore.getState().pausedAt).toBeNull();
    expect(useMidiStore.getState().lastNoteOn?.note).toBe(64);
  });

  it('pressing Pause twice keeps the first start time; note-offs still release keys', () => {
    useMidiStore.getState().setPaused(true);
    const first = useMidiStore.getState().pausedAt;
    useMidiStore.getState().setPaused(true);
    expect(useMidiStore.getState().pausedAt).toBe(first);
    useMidiStore.setState({ held: new Set([60]) });
    strike(60, 'noteoff');
    expect(useMidiStore.getState().held.size).toBe(0);
  });

  it('pauseHolds: null never holds, exactly the limit has run out', () => {
    expect(pauseHolds(null, 5)).toBe(false);
    expect(pauseHolds(0, PAUSE_MAX_MS - 1)).toBe(true);
    expect(pauseHolds(0, PAUSE_MAX_MS)).toBe(false);
  });
});
