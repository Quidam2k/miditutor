import { describe, expect, it } from 'vitest';
import { parseUsage } from '../src/renderer/components/score/useCorral';

describe('parseUsage (#6062 control-usage.json)', () => {
  it('a missing or broken file is no data', () => {
    for (const raw of [null, undefined, 'x', 7, [], { sessions: 'a', controls: 3 }]) {
      expect(parseUsage(raw)).toEqual({ sessions: 0, controls: {} });
    }
  });
  it('keeps good entries and drops bad ones', () => {
    const got = parseUsage({
      sessions: 9.7,
      controls: { hand: { uses: 2, lastUsedAt: 5, lastSession: 8, perDay: { '2026-11-13': 2 } }, bad: { uses: 'x' }, none: null },
    });
    expect(got.sessions).toBe(9);
    expect(Object.keys(got.controls)).toEqual(['hand']);
    expect(got.controls.hand).toEqual({ uses: 2, lastUsedAt: 5, lastSession: 8, perDay: { '2026-11-13': 2 } });
  });
});
