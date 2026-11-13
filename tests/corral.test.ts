import { describe, expect, it } from 'vitest';
import {
  CORRAL_AFTER_SESSIONS as N, ON_STAYS_VISIBLE, SESSION_QUIET_MS as GAP, clockEvent, emptyCorral, frontRow, hiddenOnCount, newClock, onFront, recordUse, type CorralData,
} from '../src/renderer/engine/Corral';

const at = (sessions: number, controls: CorralData['controls'] = {}): CorralData => ({ sessions, controls });
const used = (lastSession: number) => ({ uses: 1, lastUsedAt: 0, lastSession, perDay: {} });

describe('onFront (#6062)', () => {
  it('day one: nothing auto-hides, the static split stands', () => {
    expect(onFront(at(0), 'prev', true, false)).toBe(true);
    expect(onFront(at(N - 1), 'prev', true, false)).toBe(true);
    expect(onFront(at(N - 1), 'handZones', false, false)).toBe(false);
  });
  it('an untouched front control hides after N sessions', () => {
    expect(onFront(at(N), 'prev', true, false)).toBe(false);
  });
  it('a used control stays; it hides N sessions after its last use', () => {
    expect(onFront(at(N + 3, { prev: used(N + 1) }), 'prev', true, false)).toBe(true);
    expect(onFront(at(N + 1, { prev: used(1) }), 'prev', true, false)).toBe(false);
  });
  it('a corral control used from the corral comes forward, and goes back after N quiet sessions', () => {
    expect(onFront(at(2, { handZones: used(2) }), 'handZones', false, false)).toBe(true);
    expect(onFront(at(2 + N, { handZones: used(2) }), 'handZones', false, false)).toBe(false);
  });
  it('ON but untouched hides like any other (Todd msg 60575); the one switch is ON_STAYS_VISIBLE', () => {
    expect(ON_STAYS_VISIBLE).toBe(false);
    expect(onFront(at(N), 'readAhead', true, true)).toBe(false);
  });
  it('never hides the miss sound', () => {
    expect(onFront(at(100), 'missSound', true, false)).toBe(true);
  });
  it('keeps order and counts hidden ON controls', () => {
    const order = ['a', 'b', 'c', 'd'];
    const isOn = (id: string) => id === 'c' || id === 'd';
    const front = frontRow(at(N, { a: used(N) }), order, () => true, isOn);
    expect(front).toEqual(['a']);
    expect(hiddenOnCount(front, order, isOn)).toBe(2);
    expect(hiddenOnCount(order, order, () => true)).toBe(0);
  });
});

describe('recordUse', () => {
  it('counts per control and per day, in the current session', () => {
    let d = at(3);
    d = recordUse(d, 'prev', Date.UTC(2026, 10, 13, 12));
    d = recordUse(d, 'prev', Date.UTC(2026, 10, 13, 13));
    expect(d.controls.prev.uses).toBe(2);
    expect(d.controls.prev.lastSession).toBe(3);
    expect(d.controls.prev.perDay['2026-11-13']).toBe(2);
    expect(emptyCorral().sessions).toBe(0);
  });
});

describe('session clock: one stretch of playing is one session', () => {
  it('invite-on then the first note is ONE session', () => {
    let c = clockEvent(newClock(), 'invite-on', 0);
    c = clockEvent(c, 'note', 1000);
    c = clockEvent(c, 'note', 60_000);
    expect(c.started).toBe(1);
  });
  it('no invite: the first note starts one, later notes do not', () => {
    let c = clockEvent(newClock(), 'note', 5000);
    c = clockEvent(c, 'note', 9000);
    expect(c.started).toBe(1);
  });
  it('invite-off then a note right after is still the same stretch', () => {
    let c = clockEvent(newClock(), 'invite-on', 0);
    c = clockEvent(c, 'invite-off', 100_000);
    c = clockEvent(c, 'note', 110_000);
    expect(c.started).toBe(1);
  });
  it('a note after a 10-minute quiet gap is a new session', () => {
    let c = clockEvent(newClock(), 'note', 0);
    c = clockEvent(c, 'note', GAP + 1);
    expect(c.started).toBe(2);
  });
  it('invite-on after a quiet gap is a new session; invite-on while playing is not', () => {
    let c = clockEvent(newClock(), 'note', 0);
    c = clockEvent(c, 'invite-on', 1000);
    expect(c.started).toBe(1);
    c = clockEvent(c, 'invite-on', GAP * 3);
    expect(c.started).toBe(2);
  });
});
