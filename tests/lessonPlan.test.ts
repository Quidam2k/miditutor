import { describe, expect, it } from 'vitest';
import { buildPlan, lessonLabel, lessonLapDone, nextLabel, skipStep } from '../src/renderer/engine/LessonPlan';

const loop = { first: 1, last: 10 };

describe('buildPlan (#6530 F)', () => {
  it('no plan when no lap missed', () => {
    expect(buildPlan([[], [], [], [], []], loop)).toBeNull();
  });
  it('sub-loops around the missed bars in bar order, then the whole loop', () => {
    const laps = Array.from({ length: 5 }, () => [9, 4]);
    const p = buildPlan(laps, loop)!;
    expect(p.steps.map(({ first, last }) => [first, last])).toEqual([[3, 5], [8, 10], [1, 10]]);
    expect(p.steps.map((s) => s.need)).toEqual([3, 3, 1]);
    expect(p.steps[2].whole).toBe(true);
    expect(p.main).toEqual(loop);
  });
  it('a window missed in under 60% of laps needs 2 clean laps', () => {
    const laps = [[4, 9], [4], [4], [4, 9], [4]];
    const p = buildPlan(laps, loop)!;
    const at9 = p.steps.find((s) => s.first <= 9 && s.last >= 9 && !s.whole)!;
    const at4 = p.steps.find((s) => s.first <= 4 && s.last >= 4 && !s.whole)!;
    expect(at9.need).toBe(2);
    expect(at4.need).toBe(3);
  });
  it('uses only the last 6 laps and bars inside the loop', () => {
    const laps = [[2], [2], [2], [], [], [], [], [], [12]];
    expect(buildPlan(laps, loop)).toBeNull();
  });
  it('a window equal to the whole loop is left to the closing run', () => {
    const p = buildPlan([[2], [2], [2], [2], [2]], { first: 1, last: 3 })!;
    expect(p.steps).toEqual([{ first: 1, last: 3, need: 1, whole: true }]);
  });
  it('at most 4 sub-loops', () => {
    const laps = Array.from({ length: 5 }, () => [2, 7, 12, 17, 22, 27]);
    const p = buildPlan(laps, { first: 1, last: 30 })!;
    expect(p.steps.filter((s) => !s.whole).length).toBe(4);
  });
});

describe('lessonLapDone', () => {
  const plan = buildPlan(Array.from({ length: 5 }, () => [4]), loop)!;
  it('a wrong lap does not count', () => {
    const r = lessonLapDone(plan, 2);
    expect(r.state).toBe(plan);
    expect(r.advanced || r.done).toBe(false);
  });
  it('counts clean laps, moves on, then completes', () => {
    let s = plan;
    const need = s.steps[0].need;
    for (let i = 1; i < need; i++) {
      const r = lessonLapDone(s, 0);
      expect(r.advanced).toBe(false);
      s = r.state;
    }
    const r = lessonLapDone(s, 0);
    expect(r.advanced).toBe(true);
    expect(r.state.at).toBe(1);
    expect(r.state.clean).toBe(0);
    const end = lessonLapDone(r.state, 0);
    expect(end.done).toBe(true);
    expect(end.state.done).toBe(true);
    expect(lessonLapDone(end.state, 0).done).toBe(false);
  });
  it('skip moves on; skipping the last ends it', () => {
    const r = skipStep(plan);
    expect(r.state.at).toBe(1);
    expect(skipStep(r.state).done).toBe(true);
  });
  it('labels', () => {
    expect(lessonLabel(plan)).toBe('Lesson plan: step 1 of 2 · bars 3–5 · 0 of 3 clean');
    const last = skipStep(plan).state;
    expect(lessonLabel(last)).toBe('Lesson plan: step 2 of 2 · the whole loop, bars 1–10 · 0 of 1 clean');
    expect(nextLabel(last)).toBe('Next: the whole loop, bars 1–10');
  });
});
