/**
 * #6054 / #6062: where each Score toolbar control starts. ONE list, in the fixed order the controls
 * are drawn in. 'main' = the front row on day one, 'more' = the "More" menu on day one. Corral.ts then
 * moves a control by use: untouched for N sessions folds into More, one used from More comes forward.
 */
export type Place = 'main' | 'more';

export const PLACEMENT = {
  // Front row on day one
  hand: 'main',
  layout: 'main',
  follow: 'main',
  keyboard: 'main',
  loopBars: 'main',
  prev: 'main',
  next: 'main',
  watch: 'main',
  keepGoing: 'main',
  missSound: 'main',
  // More menu on day one
  simple: 'more',
  sightRead: 'more',
  freshTune: 'more',
  freshKey: 'more',
  bare: 'more',
  handZones: 'more',
  chordMoves: 'more',
  openPiece: 'more',
  trainingWheels: 'more',
  miniStaff: 'more',
  readAhead: 'more',
  scoreWheelFingers: 'more',
  keyWheelFingers: 'more',
  everyBarNumbers: 'more',
  bigNotes: 'more',
  reverseWheel: 'more',
} as const satisfies Record<string, Place>;

export type ControlId = keyof typeof PLACEMENT;

/** Every control id in fixed order. */
export const ORDER = Object.keys(PLACEMENT) as ControlId[];
export const staticFront = (id: string): boolean => PLACEMENT[id as ControlId] === 'main';
