import { describe, it, expect } from 'vitest';
import { repPrompt, shouldRemind, REP_GRACE_MS, REP_QUIET_MS, WRIST_PAUSE_MS } from '../src/renderer/engine/WristReminder';
import { useSettingsStore } from '../src/renderer/store/useSettingsStore';

const base = { on: true, now: 100_000, lastNoteAt: 100_000 - WRIST_PAUSE_MS, holding: false, shown: false };

describe('wrist reminder (#6105)', () => {
  it('is off by default', () => {
    expect(useSettingsStore.getState().wristReminder).toBe(false);
  });
  it('never fires with the toggle off', () => {
    expect(shouldRemind({ ...base, on: false, now: base.now + 10 * 60_000 })).toBe(false);
  });
  it('never fires while he is playing (recent note or a key held)', () => {
    expect(shouldRemind({ ...base, lastNoteAt: base.now - 5_000 })).toBe(false);
    expect(shouldRemind({ ...base, holding: true })).toBe(false);
  });
  it('fires at a 60 s pause, and not a moment sooner', () => {
    expect(shouldRemind(base)).toBe(true);
    expect(shouldRemind({ ...base, lastNoteAt: base.now - WRIST_PAUSE_MS + 1 })).toBe(false);
  });
  it('fires once per pause and not before he has played', () => {
    expect(shouldRemind({ ...base, shown: true })).toBe(false);
    expect(shouldRemind({ ...base, lastNoteAt: null })).toBe(false);
  });
});

describe('start/end of a rep (#6122)', () => {
  const NOW = 500_000;
  const end = { kind: 'end' as const, at: NOW - REP_QUIET_MS };
  const start = { kind: 'start' as const, at: NOW };
  const s = { on: true, now: NOW, lastNoteAt: NOW - REP_QUIET_MS, holding: false, shown: false, event: end };

  it('pause is a minute', () => {
    expect(WRIST_PAUSE_MS).toBe(60_000);
  });
  it('never with the toggle off, or with no rep event', () => {
    expect(repPrompt({ ...s, on: false })).toBe(false);
    expect(repPrompt({ ...s, event: null })).toBe(false);
  });
  it('never while a key is held', () => {
    expect(repPrompt({ ...s, holding: true })).toBe(false);
    expect(repPrompt({ ...s, holding: true, event: start, lastNoteAt: null })).toBe(false);
  });
  it('end: after 2 s of quiet, not a moment sooner', () => {
    expect(repPrompt(s)).toBe(true);
    expect(repPrompt({ ...s, now: NOW - 1 })).toBe(false);
  });
  it('end: a lap that wraps straight into the next one shows nothing', () => {
    const later = { ...end, at: NOW - 10_000 };
    // he kept playing past the wrap; now stopped for 2 s mid-next-lap
    expect(repPrompt({ ...s, event: later, lastNoteAt: NOW - REP_QUIET_MS })).toBe(false);
    // a chord's other keys landing within the grace window do not count as playing on
    expect(repPrompt({ ...s, event: { ...end, at: NOW - 5_000 }, lastNoteAt: NOW - 5_000 + REP_GRACE_MS - 1, now: NOW })).toBe(true);
  });
  it('start: only before his first note of the rep', () => {
    expect(repPrompt({ ...s, event: start, lastNoteAt: NOW - 30_000 })).toBe(true);
    expect(repPrompt({ ...s, event: start, lastNoteAt: null })).toBe(true);
    expect(repPrompt({ ...s, event: start, lastNoteAt: NOW + 1 })).toBe(false);
  });
  it('one cue per pause: once shown, neither the rep rule nor the minute rule fires again', () => {
    const shown = { ...s, shown: true };
    expect(repPrompt(shown)).toBe(false);
    expect(shouldRemind({ ...shown, now: NOW + 2 * WRIST_PAUSE_MS })).toBe(false);
  });
});
