import { describe, it, expect } from 'vitest';
import { shouldRemind, WRIST_PAUSE_MS } from '../src/renderer/engine/WristReminder';
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
  it('fires at a 20 s pause, and not a moment sooner', () => {
    expect(shouldRemind(base)).toBe(true);
    expect(shouldRemind({ ...base, lastNoteAt: base.now - WRIST_PAUSE_MS + 1 })).toBe(false);
  });
  it('fires once per pause and not before he has played', () => {
    expect(shouldRemind({ ...base, shown: true })).toBe(false);
    expect(shouldRemind({ ...base, lastNoteAt: null })).toBe(false);
  });
});
