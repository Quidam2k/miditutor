// The practice record in note-stats.json, shared by the Notes and Intervals tabs: read once per
// launch, every answer written straight back through main (atomic; localStorage can lose its last
// writes to a kill). Only one tab is mounted at a time, so the cached copy is always the latest.
import { DayTally, NoteStats, parseDayTally, parseNoteStats } from '../engine/NoteTrainer';
import { LadderLevels, parseLadder } from '../engine/Ladder';
import { MixUps, parseMixUps } from '../engine/MixUps';
import { ReviewSchedule, parseReview } from '../engine/Review';
import { Slices, parseSlices } from '../engine/Hesitation';

export interface TrainerRecord {
  stats: NoteStats;
  today: DayTally | null;
  /** #5652 D: what he played instead, per asked note. */
  mixups: MixUps;
  /** #5652 A: notes in play on the ladder, per clef setting. Only ever grows. */
  ladder: LadderLevels;
  /** #5652 I: per-note due day across days. */
  review: ReviewSchedule;
  /** #5652 E: timed hits by clef, staff position, accidental and kind of key. */
  slices: Slices;
  /** #5652 J: per interval and clef ("treble:m3"), the same shape as a note's stats. */
  intervals: NoteStats;
}

export const EMPTY_RECORD: TrainerRecord = { stats: {}, today: null, mixups: {}, ladder: {}, review: {}, slices: {}, intervals: {} };

let record: Promise<TrainerRecord> | null = null;

export function readRecord(): Promise<TrainerRecord> {
  record ??= (window.tutorBridge?.noteStatsLoad?.() ?? Promise.resolve(null))
    .catch((err: unknown) => {
      console.warn('[note-stats] load failed:', err);
      return null;
    })
    .then((raw) => {
      const saved = raw as Partial<Record<keyof TrainerRecord, unknown>> | null;
      return {
        stats: parseNoteStats(saved?.stats),
        today: parseDayTally(saved?.today),
        mixups: parseMixUps(saved?.mixups),
        ladder: parseLadder(saved?.ladder),
        review: parseReview(saved?.review),
        slices: parseSlices(saved?.slices),
        intervals: parseNoteStats(saved?.intervals),
      };
    });
  return record;
}

export function saveRecord(next: TrainerRecord): void {
  record = Promise.resolve(next);
  window.tutorBridge?.noteStatsSave?.(next);
}
