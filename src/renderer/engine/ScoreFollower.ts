// Milestone 2: pure score-following matcher. The Score view extracts one ScoreStep per
// OSMD cursor position; this decides when the cursor may advance. No DOM / OSMD here.

export interface ScoreStep {
  /** MIDI notes newly struck at this cursor position. */
  notes: number[];
  /** Position in quarter-note beats from the start. */
  beat: number;
  /** 1-based measure number. */
  measure: number;
}

export type FollowResult =
  | { kind: 'partial'; index: number; remaining: number[] }
  | { kind: 'advance'; from: number; to: number }
  | { kind: 'complete'; from: number }
  | { kind: 'wrong'; index: number; played: number; expected: number[] }
  | { kind: 'ignored' };

export class ScoreFollower {
  readonly steps: ScoreStep[];

  private currentIndex = 0;
  private satisfiedNotes = new Set<number>();
  private completions: Array<{ timeMs: number; beat: number }> = [];

  constructor(steps: ScoreStep[]) {
    this.steps = steps.map((step) => ({
      ...step,
      notes: Array.from(new Set(step.notes))
    }));
    this.seek(0);
  }

  get index(): number {
    return this.currentIndex;
  }

  get finished(): boolean {
    return this.currentIndex >= this.steps.length;
  }

  get satisfied(): ReadonlySet<number> {
    return this.satisfiedNotes;
  }

  get expected(): number[] {
    return this.finished ? [] : [...this.steps[this.currentIndex].notes];
  }

  noteOn(midi: number, timeMs: number): FollowResult {
    if (this.finished) {
      return { kind: 'ignored' };
    }

    const expected = this.steps[this.currentIndex].notes;

    if (this.satisfiedNotes.has(midi)) {
      return { kind: 'ignored' };
    }

    if (!expected.includes(midi)) {
      return {
        kind: 'wrong',
        index: this.currentIndex,
        played: midi,
        expected: [...expected]
      };
    }

    this.satisfiedNotes.add(midi);

    if (this.satisfiedNotes.size < expected.length) {
      const remaining = expected
        .filter((note) => !this.satisfiedNotes.has(note))
        .sort((a, b) => a - b);
      return { kind: 'partial', index: this.currentIndex, remaining };
    }

    const from = this.currentIndex;
    this.completions.push({ timeMs, beat: this.steps[from].beat });
    if (this.completions.length > 8) {
      this.completions.shift();
    }

    this.currentIndex = this.findNextPlayable(from + 1);
    this.satisfiedNotes.clear();

    if (this.finished) {
      return { kind: 'complete', from };
    }

    return { kind: 'advance', from, to: this.currentIndex };
  }

  seek(i: number): void {
    const start = Number.isFinite(i)
      ? Math.max(0, Math.min(this.steps.length, Math.trunc(i)))
      : 0;
    this.currentIndex = this.findNextPlayable(start);
    this.satisfiedNotes.clear();
    this.completions = [];
  }

  reset(): void {
    this.seek(0);
  }

  get paceBpm(): number | null {
    if (this.completions.length < 2) {
      return null;
    }

    const first = this.completions[0];
    const last = this.completions[this.completions.length - 1];
    const dt = last.timeMs - first.timeMs;
    const dBeat = last.beat - first.beat;

    if (dt <= 0 || dBeat <= 0) {
      return null;
    }

    return Math.round(dBeat / (dt / 60000));
  }

  private findNextPlayable(start: number): number {
    let index = start;
    while (index < this.steps.length && this.steps[index].notes.length === 0) {
      index += 1;
    }
    return index;
  }
}
