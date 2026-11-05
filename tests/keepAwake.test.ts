import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { KeepAwake, KEEP_AWAKE_IDLE_MS } from '../src/main/keepAwake';

describe('KeepAwake (#5522)', () => {
  let next = 1;
  const blocker = { start: vi.fn(() => next++), stop: vi.fn() };
  beforeEach(() => {
    vi.useFakeTimers();
    next = 1;
    blocker.start.mockClear();
    blocker.stop.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('holds one blocker however many notes, released 15 min after the last', () => {
    const k = new KeepAwake({ blocker });
    k.noteOn();
    vi.advanceTimersByTime(60_000);
    k.noteOn();
    k.noteOn();
    expect(blocker.start).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(KEEP_AWAKE_IDLE_MS - 1);
    expect(k.held).toBe(true);
    vi.advanceTimersByTime(1);
    expect(k.held).toBe(false);
    expect(blocker.stop).toHaveBeenCalledWith(1);
    k.noteOn();
    expect(blocker.start).toHaveBeenCalledTimes(2);
    k.dispose();
    expect(blocker.stop).toHaveBeenLastCalledWith(2);
  });

  it('off releases at once and ignores notes until turned back on', () => {
    const k = new KeepAwake({ blocker });
    k.noteOn();
    k.setEnabled(false);
    expect(blocker.stop).toHaveBeenCalledWith(1);
    k.noteOn();
    expect(k.held).toBe(false);
    k.setEnabled(true);
    expect(k.held).toBe(false);
    k.noteOn();
    expect(k.held).toBe(true);
  });

  it('disabled at construction never holds', () => {
    const k = new KeepAwake({ blocker, enabled: false });
    k.noteOn();
    expect(blocker.start).not.toHaveBeenCalled();
  });
});
