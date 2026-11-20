import { describe, expect, it } from 'vitest';
import { ADVICE_GAP_MS, mayOffer, quietToday } from '../src/renderer/engine/Advice';

describe('Advice gate (#6530 E)', () => {
  it('offers the first banner, then waits 5 minutes for the next', () => {
    expect(mayOffer('speed', 1000, '2026-11-19', null, {})).toBe(true);
    expect(mayOffer('speed', 1000 + ADVICE_GAP_MS - 1, '2026-11-19', 1000, {})).toBe(false);
    expect(mayOffer('speed', 1000 + ADVICE_GAP_MS, '2026-11-19', 1000, {})).toBe(true);
  });
  it('"Not today" quiets the rule until the next day', () => {
    const quiet = quietToday({}, 'speed', '2026-11-19');
    expect(mayOffer('speed', 0, '2026-11-19', null, quiet)).toBe(false);
    expect(mayOffer('speed', 0, '2026-11-20', null, quiet)).toBe(true);
  });
  it('drops quiet entries from other days', () => {
    expect(quietToday({ speed: '2026-11-18' }, 'speed', '2026-11-19')).toEqual({ speed: '2026-11-19' });
  });
});
