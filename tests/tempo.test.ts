import { describe, expect, it } from 'vitest';
import { markedTempo, playedTempo } from '../src/renderer/engine/Tempo';

const mark = (unit: string, per: number, dot = false) =>
  `<direction><direction-type><metronome><beat-unit>${unit}</beat-unit>${dot ? '<beat-unit-dot/>' : ''}<per-minute>${per}</per-minute></metronome></direction-type></direction>`;

describe('markedTempo', () => {
  it('reads <sound tempo> first', () => {
    expect(markedTempo(`${mark('half', 40)}<sound tempo="80"/>`)).toBe(80);
  });
  it('converts a bare metronome mark to quarters', () => {
    expect(markedTempo(mark('quarter', 96))).toBe(96);
    expect(markedTempo(mark('half', 60))).toBe(120);
    expect(markedTempo(mark('quarter', 60, true))).toBe(90);
    expect(markedTempo(mark('eighth', 120))).toBe(60);
  });
  it('is null with no mark or a nonsense one', () => {
    expect(markedTempo('<score-partwise></score-partwise>')).toBeNull();
    expect(markedTempo('<sound dynamics="80"/>')).toBeNull();
    expect(markedTempo(mark('breve', 60))).toBeNull();
  });
  it('reads the bundled Minuet', async () => {
    const { readFileSync } = await import('node:fs');
    expect(markedTempo(readFileSync('src/renderer/assets/minuet-in-g.musicxml', 'utf8'))).toBe(100);
  });
});

describe('playedTempo', () => {
  it('averages quarters per minute', () => {
    expect(playedTempo(8, 6000)).toBe(80);
    expect(playedTempo(0, 6000)).toBeNull();
    expect(playedTempo(8, 0)).toBeNull();
  });
});
