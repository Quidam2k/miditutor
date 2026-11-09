import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

/**
 * Make drawFrom/UpToMeasureNumber count bars by position in the file, as the app and the scan layouts do.
 * Call after setOptions (or load) and right before render(). Without it, OSMD draws a piece that opens
 * with a pickup one bar late: render() re-reads the numbers as indexes (#5731).
 */
export function drawRangeByPosition(osmd: OpenSheetMusicDisplay): void {
  osmd.EngravingRules.MinMeasureToDrawNumber = 0;
  osmd.EngravingRules.MaxMeasureToDrawNumber = 0;
}
