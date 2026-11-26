import { describe, expect, it } from 'vitest';
import { isPracticeNote, tallyNote, type PracticeTally } from '../src/renderer/engine/PracticeTally';
import { useMidiStore } from '../src/renderer/store/useMidiStore';

const MIN = 60 * 1000;
// Plays a note every 30 s for `minutes`, starting from `t`.
function play(t: PracticeTally | null, start: number, minutes: number): PracticeTally | null {
  for (let at = start; at <= start + minutes * MIN; at += 30000) t = tallyNote(t, at);
  return t;
}

describe('practice tally (#7065)', () => {
  it('paused play for 8 minutes adds 8 minutes, live, with no lump on resume', () => {
    const store = useMidiStore.getState();
    let t: PracticeTally | null = null;
    const seen: number[] = [];
    const unsub = useMidiStore.subscribe((state, prev) => {
      const entry = state.noteLog[0];
      if (entry === prev.noteLog[0] || !isPracticeNote(entry)) return;
      t = tallyNote(t, entry.timestamp);
      seen.push(t.totalMs);
    });
    store.ingestNote({ kind: 'noteon', note: 60, velocity: 80, channel: 1, source: 'hardware', timestamp: 0 });
    store.setPaused(true);
    for (let at = 30000; at <= 8 * MIN; at += 30000) {
      store.ingestNote({ kind: 'noteon', note: 62, velocity: 80, channel: 1, source: 'hardware', timestamp: at });
    }
    expect(useMidiStore.getState().pausedAt).not.toBeNull();
    expect(t!.totalMs).toBe(8 * MIN); // ticked while paused
    store.setPaused(false);
    store.ingestNote({ kind: 'noteon', note: 64, velocity: 80, channel: 1, source: 'hardware', timestamp: 8 * MIN + 5000 });
    expect(t!.totalMs).toBe(8 * MIN + 5000); // resume adds only the real 5 s
    unsub();
  });

  it('paused with no notes for over 10 minutes adds nothing (idle rule)', () => {
    let t = play(null, 0, 2)!;
    const before = t.totalMs;
    t = tallyNote(t, 2 * MIN + 11 * MIN);
    expect(t.totalMs).toBe(before);
  });

  it('unpaused play is unchanged', () => {
    expect(play(null, 0, 5)!.totalMs).toBe(5 * MIN);
  });

  it("the tutor's injected notes and note-offs are not practice", () => {
    expect(isPracticeNote({ kind: 'noteon', source: 'inject' })).toBe(false);
    expect(isPracticeNote({ kind: 'noteoff', source: 'hardware' })).toBe(false);
    expect(isPracticeNote(undefined)).toBe(false);
    expect(isPracticeNote({ kind: 'noteon', source: 'hardware' })).toBe(true);
  });
});
