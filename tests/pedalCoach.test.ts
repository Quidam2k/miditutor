import { describe, expect, it } from 'vitest';
import { PedalCoach } from '../src/renderer/engine/PedalCoach';

const empty = new Set<number>();
const ringing = new Set([60]);
const ctx = { bar: 2, step: 3, restBefore: false };

describe('PedalCoach', () => {
  it('reports an early lift with the next note and score position', () => {
    const coach = new PedalCoach();

    coach.pedal(false, 1000, empty, ringing);

    expect(coach.noteOn(64, 1400, ctx)).toEqual({
      gapMs: 400,
      bar: 2,
      step: 3,
      nextNote: 64
    });
  });

  it('does not report a lift that happens after the next note', () => {
    const coach = new PedalCoach();

    const result = coach.noteOn(64, 1400, ctx);
    coach.pedal(false, 1450, new Set([64]), ringing);

    expect(result).toBeNull();
  });

  it('does not arm while a key is held', () => {
    const coach = new PedalCoach();

    coach.pedal(false, 1000, new Set([60]), ringing);

    expect(coach.noteOn(64, 1400, ctx)).toBeNull();
  });

  it('does not arm when nothing is ringing', () => {
    const coach = new PedalCoach();

    coach.pedal(false, 1000, empty, empty);

    expect(coach.noteOn(64, 1400, ctx)).toBeNull();
  });

  it('ignores a lift before a written rest', () => {
    const coach = new PedalCoach();

    coach.pedal(false, 1000, empty, ringing);

    expect(
      coach.noteOn(64, 1400, { ...ctx, restBefore: true })
    ).toBeNull();
  });

  it.each([0, 119, 120])('ignores a gap of %i ms', (gapMs) => {
    const coach = new PedalCoach();

    coach.pedal(false, 1000, empty, ringing);

    expect(coach.noteOn(64, 1000 + gapMs, ctx)).toBeNull();
  });

  it.each([3000, 3001, 5000])('ignores a gap of %i ms', (gapMs) => {
    const coach = new PedalCoach();

    coach.pedal(false, 1000, empty, ringing);

    expect(coach.noteOn(64, 1000 + gapMs, ctx)).toBeNull();
  });

  it('keeps the lift armed when the pedal is pressed again', () => {
    const coach = new PedalCoach();

    coach.pedal(false, 1000, empty, ringing);
    coach.pedal(true, 1200, empty, empty);

    expect(coach.noteOn(64, 1400, ctx)).toEqual({
      gapMs: 400,
      bar: 2,
      step: 3,
      nextNote: 64
    });
  });

  it('clears an armed lift on reset', () => {
    const coach = new PedalCoach();

    coach.pedal(false, 1000, empty, ringing);
    coach.reset();

    expect(coach.noteOn(64, 1400, ctx)).toBeNull();
  });

  it('judges only the first note after a lift', () => {
    const coach = new PedalCoach();

    coach.pedal(false, 1000, empty, ringing);

    expect(coach.noteOn(64, 1400, ctx)).toEqual({
      gapMs: 400,
      bar: 2,
      step: 3,
      nextNote: 64
    });
    expect(coach.noteOn(67, 1500, ctx)).toBeNull();
  });

  it('consumes the lift even when the first gap is too short', () => {
    const coach = new PedalCoach();

    coach.pedal(false, 1000, empty, ringing);

    expect(coach.noteOn(64, 1100, ctx)).toBeNull();
    expect(coach.noteOn(67, 1400, ctx)).toBeNull();
  });

  it('disarms an earlier lift when a later lift has a held key', () => {
    const coach = new PedalCoach();

    coach.pedal(false, 1000, empty, ringing);
    coach.pedal(false, 1200, new Set([60]), ringing);

    expect(coach.noteOn(64, 1400, ctx)).toBeNull();
  });

  it('disarms an earlier lift when a later lift has nothing ringing', () => {
    const coach = new PedalCoach();

    coach.pedal(false, 1000, empty, ringing);
    coach.pedal(false, 1200, empty, empty);

    expect(coach.noteOn(64, 1400, ctx)).toBeNull();
  });

  it('uses custom gap limits with strict boundaries', () => {
    const coach = new PedalCoach({ minGapMs: 200, maxGapMs: 500 });

    coach.pedal(false, 1000, empty, ringing);
    expect(coach.noteOn(64, 1200, ctx)).toBeNull();

    coach.pedal(false, 2000, empty, ringing);
    expect(coach.noteOn(64, 2300, ctx)).toEqual({
      gapMs: 300,
      bar: 2,
      step: 3,
      nextNote: 64
    });

    coach.pedal(false, 3000, empty, ringing);
    expect(coach.noteOn(64, 3500, ctx)).toBeNull();
  });
});
