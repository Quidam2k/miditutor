import { describe, it, expect } from 'vitest';
import { REVEAL_AFTER, accidentalNames, gateAsk, gateDone, gateShown, keyGate, keyGateInput } from '../src/renderer/engine/KeyFirst';

describe('key first', () => {
  it('names the signature in order', () => {
    expect(accidentalNames(2)).toEqual(['F#', 'C#']);
    expect(accidentalNames(-4)).toEqual(['Bb', 'Eb', 'Ab', 'Db']);
    expect(accidentalNames(0)).toEqual([]);
    expect(gateAsk(-3)).toBe('play its 3 flats');
    expect(gateAsk(1)).toBe('play its sharp');
  });

  it('has nothing to ask in C', () => {
    expect(keyGate(0)).toBeNull();
    expect(gateDone(null)).toBe(true);
  });

  it('takes the accidentals in any octave and order, flags the rest', () => {
    let g = keyGate(-3)!; // Bb Eb Ab
    let r = keyGateInput(g, 56); // Ab3
    expect(r.event).toBe('got');
    r = keyGateInput(r.gate, 68); // Ab4 again
    expect(r.event).toBe('again');
    r = keyGateInput(r.gate, 66); // F#/Gb: not in Eb major
    expect(r.event).toBe('wrong');
    expect(r.gate.wrong).toBe(6);
    r = keyGateInput(r.gate, 70); // Bb4
    expect(r.gate.wrong).toBeNull();
    expect(gateShown(r.gate)).toEqual(['Bb', '?', 'Ab']);
    r = keyGateInput(r.gate, 39); // Eb2
    expect(r.event).toBe('done');
    expect(gateDone(r.gate)).toBe(true);
    g = r.gate;
    expect(g.misses).toBe(1);
  });

  it('shows the names after enough wrong keys', () => {
    let g = keyGate(2)!;
    for (let i = 0; i < REVEAL_AFTER; i++) g = keyGateInput(g, 60).gate;
    expect(gateShown(g)).toEqual(['F#', 'C#']);
  });
});
