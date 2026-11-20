import { describe, expect, it } from 'vitest';
import { rolandChecksum, rolandMessage, type RolandParam } from '../src/renderer/engine/RolandMetronome';

const hex = (m: number[]) => m.map((b) => b.toString(16).padStart(2, '0')).join(' ');

describe('rolandMessage', () => {
  it('builds a DT1 tempo message, two 7-bit bytes', () => {
    // 01+00+03+09+00+3c = 0x49 -> checksum 0x37
    expect(hex(rolandMessage('tempo', 60))).toBe('f0 41 10 00 00 00 28 12 01 00 03 09 00 3c 37 f7');
    expect(rolandMessage('tempo', 200).slice(12, 14)).toEqual([1, 72]);
  });
  it('builds on/off, beat and volume', () => {
    expect(hex(rolandMessage('on', 1))).toBe('f0 41 10 00 00 00 28 12 01 00 03 1a 01 61 f7');
    expect(rolandMessage('beat', 3).slice(8, 13)).toEqual([0x01, 0x00, 0x02, 0x1f, 3]);
    expect(rolandMessage('volume', 5).slice(8, 13)).toEqual([0x01, 0x00, 0x02, 0x21, 5]);
  });
  it('every message checks out: address + data + checksum = 0 mod 128', () => {
    for (const [p, v] of [['on', 0], ['tempo', 133], ['beat', 9], ['volume', 10]] as [RolandParam, number][]) {
      const m = rolandMessage(p, v);
      expect(m.slice(8, -1).reduce((a, b) => a + b, 0) % 128).toBe(0);
      expect(m.every((b, i) => i === 0 || i === m.length - 1 || b < 0x80)).toBe(true);
    }
  });
  it('refuses any other parameter and out-of-range values', () => {
    expect(() => rolandMessage('toString' as RolandParam, 1)).toThrow(/refusing/);
    expect(() => rolandMessage('tone' as RolandParam, 1)).toThrow(/refusing/);
    expect(() => rolandMessage('tempo', 10)).toThrow(/outside/);
    expect(() => rolandMessage('tempo', 60.5)).toThrow(/outside/);
    expect(() => rolandMessage('on', 2)).toThrow(/outside/);
    expect(() => rolandMessage('volume', 11)).toThrow(/outside/);
  });
  it('checksum of nothing is 0', () => {
    expect(rolandChecksum([])).toBe(0);
  });
});
