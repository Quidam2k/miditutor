// #5853: which help the screen gives right now, logged so the practice history can say
// whether a stretch was played with the keyboard lights and hints on or off.
// Each level mirrors ScoreView's own rules (the `hints` / `hintsOff` expressions there).

/** always = shown all the time; wheels = training wheels (a lap's first bar, a pause or a miss);
 *  on-pause = only after a pause or a miss; none = never. */
export type HintLevel = 'always' | 'wheels' | 'on-pause' | 'none';

export interface HintFlags {
  showKeyboard: boolean;
  trainingWheels: boolean;
  miniStaff: boolean;
  hintsOffNew: boolean;
  /** A fresh tune or sight-read pick with "Hints off for new pieces" on. */
  quietNew: boolean;
  /** "5 min, no hints" running on this piece. */
  bare: boolean;
  readAhead: boolean;
  /** Keep going: the green keys stay dark while the cursor runs (names and mini staff stay). */
  keeping: boolean;
}

export interface HintsSnapshot extends HintFlags {
  /** The green "play me" keys on the keyboard strip. */
  keys: HintLevel;
  /** The note names in the status line. */
  names: HintLevel;
  /** The scrap of staff above the keyboard. */
  mini: HintLevel;
}

export function hintsSnapshot(f: HintFlags): HintsSnapshot {
  const hintsOff = f.bare || f.quietNew || f.readAhead;
  const keyRule: HintLevel = f.bare ? 'none' : f.readAhead || f.quietNew ? 'on-pause' : f.trainingWheels ? 'wheels' : 'always';
  const keys: HintLevel = !f.showKeyboard || f.keeping ? 'none' : keyRule;
  const names: HintLevel = f.bare ? 'none' : hintsOff ? 'on-pause' : 'always';
  const mini: HintLevel = !f.showKeyboard || !f.miniStaff ? 'none' : names;
  return { ...f, keys, names, mini };
}

export function sameHints(a: HintsSnapshot | null, b: HintsSnapshot): boolean {
  return !!a && (Object.keys(b) as (keyof HintsSnapshot)[]).every((k) => a[k] === b[k]);
}
