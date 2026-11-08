import { OpenSheetMusicDisplay, TechnicalInstructionType } from 'opensheetmusicdisplay';
import { fingersLowToHigh } from './noteEdit';

/** The parts of OSMD's source score that hold a chord's finger marks. */
interface OsmdSourceMeasure {
  VerticalSourceStaffEntryContainers: {
    StaffEntries: ({
      VoiceEntries: {
        TechnicalInstructions: { type: number; sourceNote?: { Pitch?: { getHalfTone(): number } } }[];
      }[];
    } | undefined)[];
  }[];
}

// #10256: stacked left-hand fingers read top to bottom as the notes do. Before each layout, so a
// re-render can't bring the old order back; it's a sort, so doing it again changes nothing.
export function orderChordFingers(osmd: OpenSheetMusicDisplay) {
  const sheet = osmd.Sheet as unknown as { SourceMeasures?: OsmdSourceMeasure[] } | undefined;
  for (const measure of sheet?.SourceMeasures ?? []) {
    for (const container of measure.VerticalSourceStaffEntryContainers) {
      for (const entry of container.StaffEntries) {
        for (const voice of entry?.VoiceEntries ?? []) {
          fingersLowToHigh(voice.TechnicalInstructions, (m) => m.type === TechnicalInstructionType.Fingering,
            (m) => m.sourceNote?.Pitch?.getHalfTone());
        }
      }
    }
  }
}
