/**
 * #6055: Strip zoom that fills the panel with the MUSIC, not with OSMD's SVG box (which is mostly
 * blank margin, so the old fit thought it was already full and left dead bands above and below).
 */
export const STRIP_MAX_ZOOM = 3;
/** Below the old floor of 1 so a short panel shrinks the music rather than clipping it. */
export const STRIP_MIN_ZOOM = 0.5;
/** Share of the free height the ink may use; the rest is breathing room for fingers and the tempo mark. */
export const STRIP_FILL = 0.94;

/**
 * @param inkPx   height in px of the drawn music (top of the tempo mark / ledger lines to the bottom ink) at `current`
 * @param freePx  height in px of the panel's usable area
 * @param current the zoom `inkPx` was measured at
 * @returns the new zoom, or `current` when it is already within 5% of it
 */
export function fitZoom(inkPx: number, freePx: number, current: number): number {
  if (!(inkPx > 0) || !(freePx > 0) || !(current > 0)) return current;
  const zoom = Math.max(STRIP_MIN_ZOOM, Math.min(STRIP_MAX_ZOOM, (current * freePx * STRIP_FILL) / inkPx));
  return Math.abs(zoom - current) / current < 0.05 ? current : zoom;
}

/** Pixels to shift the music down (+) or up (-) so its ink is centred in the free area. */
export function centreShift(inkTop: number, inkBottom: number, areaTop: number, areaBottom: number): number {
  return Math.round((areaTop + areaBottom) / 2 - (inkTop + inkBottom) / 2);
}
