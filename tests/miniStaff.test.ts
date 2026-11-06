import { describe, it, expect } from 'vitest';
import { keyNameOfFifths, miniStaffParts } from '../src/renderer/components/score/MiniStaff';
import { keyCenterPct } from '../src/renderer/components/homework/PianoKeyboard88';

const g4 = { note: 'G' as const, octave: 4, midiNumber: 67 };
const b2 = { note: 'B' as const, octave: 2, midiNumber: 47 };

describe('mini staff above the keyboard (#5624)', () => {
  it('names the key from the signature, clamped', () => {
    expect(keyNameOfFifths(-3)).toBe('Eb');
    expect(keyNameOfFifths(0)).toBe('C');
    expect(keyNameOfFifths(2)).toBe('D');
    expect(keyNameOfFifths(9)).toBe('C#');
  });

  it('shows only the hands that play now', () => {
    const upper = { clef: 'treble' as const, notes: [g4] };
    const lower = { clef: 'bass' as const, notes: [b2] };
    const none = (clef: 'treble' | 'bass') => ({ clef, notes: [] });
    expect(miniStaffParts(upper, none('bass')).map((p) => p.clef)).toEqual(['treble']);
    expect(miniStaffParts(none('treble'), lower).map((p) => p.clef)).toEqual(['bass']);
    expect(miniStaffParts(upper, lower).map((p) => p.clef)).toEqual(['treble', 'bass']);
    expect(miniStaffParts(none('treble'), none('bass'))).toEqual([]);
  });

  it('sits over the keys being played', () => {
    expect(keyCenterPct(21)).toBeLessThan(2);
    expect(keyCenterPct(108)).toBeGreaterThan(98);
    expect(keyCenterPct(60)).toBeGreaterThan(40);
    expect(keyCenterPct(60)).toBeLessThan(50);
  });
});
