/**
 * #6054: where each Score toolbar control lives. ONE list: moving a control back onto the main row
 * is a one-line change here ('menu' -> 'main'). A control that is ON while tucked in a menu is shown
 * on the main row by the badge on its menu button (count on Options, names on Practice modes).
 */
export type Place = 'main' | 'practice' | 'options';

export const PLACEMENT = {
  // Practice modes menu
  simple: 'practice',
  sightRead: 'practice',
  freshTune: 'practice',
  freshKey: 'practice',
  bare: 'practice',
  handZones: 'practice',
  chordMoves: 'practice',
  openPiece: 'practice',
  // Options menu
  trainingWheels: 'options',
  miniStaff: 'options',
  readAhead: 'options',
  missSound: 'options',
  scoreWheelFingers: 'options',
  keyWheelFingers: 'options',
  everyBarNumbers: 'options',
  bigNotes: 'options',
  reverseWheel: 'options',
} as const satisfies Record<string, Place>;

export type ControlId = keyof typeof PLACEMENT;

/** Every control id in list order, or only those placed at `place`. */
export const idsAt = (place?: Place): ControlId[] =>
  (Object.keys(PLACEMENT) as ControlId[]).filter((id) => place === undefined || PLACEMENT[id] === place);

/** The ids that show on the menu button's own label when ON: a menu never hides a running mode. */
export function menuBadge(place: Place, on: Partial<Record<ControlId, boolean>>, names: Partial<Record<ControlId, string>>) {
  const live = idsAt(place).filter((id) => on[id]);
  return { count: live.length, names: live.map((id) => names[id] ?? id) };
}
