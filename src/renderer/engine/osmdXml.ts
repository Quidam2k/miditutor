// The one way MusicXML goes into OSMD (#6612): chord-marked rests dropped (they blank the
// window) and beams added by the meter (his scores carry none, so OSMD drew flags in 9/8 and 3/8).
// Only the copy handed to OSMD changes; the practice engine and the file on disk keep the original.
import { addBeams } from './autoBeam';
import { dropChordRests } from './chordRests';

export function forOsmd(xml: string): string {
  const drawable = dropChordRests(xml);
  try {
    return addBeams(drawable);
  } catch {
    return drawable; // beams are a nicety: a score must still draw without them
  }
}
