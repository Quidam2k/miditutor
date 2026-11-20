import { describe, expect, it } from 'vitest';
import {
  ADVICE_GAP_MS, actionLabel, mayOffer, pauseCard, quietToday, reshapeCard, spotBackCard, velocityCard, worseCard,
} from '../src/renderer/engine/Advice';

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

describe('Advice cards (#6530 E)', () => {
  it('reshape: names the clean bars and the new loops', () => {
    const c = reshapeCard([{ first: 1, last: 8 }], [{ first: 9, last: 13 }, { first: 16, last: 20 }]);
    expect(c.text).toBe('Bars 1-8 are clean: try two 5-bar loops at 9-13 and 16-20.');
    expect(c.action && actionLabel(c.action)).toBe('Use these');
  });
  it('reshape: mixed sizes and one loop', () => {
    expect(reshapeCard([{ first: 1, last: 4 }, { first: 9, last: 12 }], [{ first: 5, last: 8 }]).text)
      .toBe('Bars 1-4 and bars 9-12 are clean: try a 4-bar loop at 5-8.');
    expect(reshapeCard([{ first: 1, last: 3 }], [{ first: 4, last: 6 }, { first: 7, last: 10 }]).text)
      .toBe('Bars 1-3 are clean: try two loops at 4-6 and 7-10.');
  });
  it('pause: loops the bar before and the bar, not before the loop', () => {
    const c = pauseCard(5, 3, 1);
    expect(c.text).toBe('You pause before bar 5 every time. Loop bars 4-5?');
    expect(c.action).toEqual({ kind: 'loop', span: { first: 4, last: 5 } });
    expect(pauseCard(5, 3, 5).action).toEqual({ kind: 'loop', span: { first: 5, last: 5 } });
    expect(actionLabel(pauseCard(5, 3, 1).action!)).toBe('Loop bars 4-5');
  });
  it('worse, velocity, spot back', () => {
    expect(worseCard(7, 2, [{ first: 3, last: 5 }]).text)
      .toBe('This pass had 7 wrong; your best this week had 2. The new trouble is at bars 3-5.');
    expect(velocityCard('E4', 6, 0.62, 3, 'R').text)
      .toBe('The E4 in bar 6 (right hand) keeps coming out quieter than the notes around it (about 62% as loud).');
    expect(velocityCard('E4', 6, 0.62, 3, 'R').action).toBeUndefined();
    expect(spotBackCard({ first: 9, last: 11 }, 3, 4).text).toBe('Bars 9-11 came off your list 3 days ago; the misses are back (4 today).');
    expect(spotBackCard({ first: 9, last: 11 }, 1, 4).text).toContain('yesterday');
  });
});
