import { MasteryRecord } from '../types/music';

const MASTERY_WINDOW = 10;
const MASTERY_THRESHOLD = 0.9; // 90% accuracy over last 10
const INITIAL_LOW = 60; // C4
const INITIAL_HIGH = 64; // E4

export class DifficultyManager {
  private mastery: Map<number, MasteryRecord> = new Map();
  private _rangeLow: number = INITIAL_LOW;
  private _rangeHigh: number = INITIAL_HIGH;
  private includeAccidentals = false;

  get rangeLow(): number { return this._rangeLow; }
  get rangeHigh(): number { return this._rangeHigh; }
  get accidentals(): boolean { return this.includeAccidentals; }

  recordAttempt(midiNumber: number, correct: boolean): void {
    let record = this.mastery.get(midiNumber);
    if (!record) {
      record = { midiNumber, attempts: 0, correct: 0, recentResults: [], mastered: false };
      this.mastery.set(midiNumber, record);
    }

    record.attempts++;
    if (correct) record.correct++;
    record.recentResults.push(correct);

    // Keep only last N results
    if (record.recentResults.length > MASTERY_WINDOW) {
      record.recentResults.shift();
    }

    // Check mastery if we have enough data
    if (record.recentResults.length >= MASTERY_WINDOW) {
      const recentAccuracy = record.recentResults.filter(Boolean).length / MASTERY_WINDOW;
      record.mastered = recentAccuracy >= MASTERY_THRESHOLD;
    }

    this.maybeExpandRange();
  }

  private maybeExpandRange(): void {
    // Check if all notes in current range are mastered
    let allMastered = true;
    for (let midi = this._rangeLow; midi <= this._rangeHigh; midi++) {
      const record = this.mastery.get(midi);
      if (!record || !record.mastered) {
        allMastered = false;
        break;
      }
    }

    if (!allMastered) return;

    // Expand range by one note in each direction
    if (this._rangeLow > 48) this._rangeLow--; // Don't go below C3
    if (this._rangeHigh < 84) this._rangeHigh++; // Don't go above C6

    // Enable accidentals once range is wide enough
    if (this._rangeHigh - this._rangeLow >= 12) {
      this.includeAccidentals = true;
    }
  }

  getMastery(midiNumber: number): MasteryRecord | undefined {
    return this.mastery.get(midiNumber);
  }

  getOverallAccuracy(): number {
    let total = 0;
    let correct = 0;
    for (const record of this.mastery.values()) {
      total += record.attempts;
      correct += record.correct;
    }
    return total === 0 ? 0 : correct / total;
  }

  reset(): void {
    this.mastery.clear();
    this._rangeLow = INITIAL_LOW;
    this._rangeHigh = INITIAL_HIGH;
    this.includeAccidentals = false;
  }
}
