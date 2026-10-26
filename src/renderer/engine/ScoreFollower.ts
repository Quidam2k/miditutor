// Milestone 2: pure score-following matcher. The Score view extracts one ScoreStep per
// OSMD cursor position; this decides when the cursor may advance. No DOM / OSMD here.
// #5004: an optional loop range wraps back to its first step instead of finishing.
// #9480: notes still sounding (key held, or let ring under the sustain pedal) that the
// next step asks for again are carried over, so he need not re-strike them.

export interface ScoreStep {
  /** MIDI notes newly struck at this cursor position. */
  notes: number[];
  /** Position in quarter-note beats from the start. */
  beat: number;
  /** 1-based measure number. */
  measure: number;
  /** Written notes still sounding here (tied or held over); a re-strike is not wrong. */
  ringing?: number[];
}

export type FollowResult =
  | { kind: 'partial'; index: number; remaining: number[] }
  | { kind: 'advance'; from: number; to: number }
  | { kind: 'complete'; from: number }
  | { kind: 'loop'; from: number; to: number; lap: number }
  | { kind: 'wrong'; index: number; played: number; expected: number[] }
  | { kind: 'ignored' };

export class ScoreFollower {
  readonly steps: ScoreStep[];

  private currentIndex = 0;
  private satisfiedNotes = new Set<number>();
  private completions: Array<{ timeMs: number; beat: number }> = [];
  private loopRange: { first: number; last: number } | null = null;
  private currentLap = 1;
  // Added to each completion's beat after a lap wrap, so pace stays continuous.
  private beatOffset = 0;
  // Notes carried into the step he just left; a late re-strike of one is not wrong.
  private prevCarried = new Set<number>();

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

  get range(): { first: number; last: number } | null {
    return this.loopRange ? { ...this.loopRange } : null;
  }

  get lap(): number {
    return this.currentLap;
  }

  /** Loop steps first..last (inclusive, swapped if reversed) and go to the first. */
  setRange(first: number, last: number): void {
    const maxIndex = Math.max(0, this.steps.length - 1);
    const clamp = (i: number) => (Number.isFinite(i) ? Math.max(0, Math.min(maxIndex, Math.trunc(i))) : 0);
    const a = clamp(first);
    const b = clamp(last);
    this.loopRange = { first: Math.min(a, b), last: Math.max(a, b) };
    this.seek(this.loopRange.first);
    this.currentLap = 1;
    // A range with nothing to play behaves as finished (every note is ignored).
    if (this.currentIndex > this.loopRange.last) this.currentIndex = this.steps.length;
  }

  clearRange(): void {
    this.loopRange = null;
    this.currentLap = 1;
  }

  /**
   * One key struck. `sounding` = notes still ringing right now (keys held down, plus
   * keys released while the sustain pedal is down), excluding this one.
   */
  noteOn(midi: number, timeMs: number, sounding: ReadonlySet<number> = new Set()): FollowResult {
    if (this.finished) {
      return { kind: 'ignored' };
    }

    // A loop over bars with nothing to play (all rests): nothing to follow.
    if (this.loopRange && this.findNextPlayable(this.loopRange.first) > this.loopRange.last) {
      return { kind: 'ignored' };
    }

    const expected = this.steps[this.currentIndex].notes;

    if (this.satisfiedNotes.has(midi)) {
      return { kind: 'ignored' };
    }

    if (!expected.includes(midi)) {
      if (this.prevCarried.has(midi) || this.steps[this.currentIndex].ringing?.includes(midi)) {
        return { kind: 'ignored' };
      }
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

    // The key that just finished this step is not carried: a repeated written note
    // (Auld Lang Syne's F4 F4) must be struck again (#9630).
    const ringing = new Set(sounding);
    ringing.delete(midi);
    const from = this.currentIndex;
    let lapped = false;
    this.prevCarried.clear();
    // Advance; a step fully covered by carried-over notes completes on its own.
    for (let guard = 0; guard <= this.steps.length; guard++) {
      const done = this.currentIndex;
      this.completeStep(done, timeMs);
      // Never carry across a lap wrap: the note just struck would cover its own step.
      if (this.moveOn(done)) {
        lapped = true;
        break;
      }
      if (this.finished) break;
      const carried = this.carryOver(done, ringing);
      if (carried < this.steps[this.currentIndex].notes.length) break;
    }

    if (this.finished) {
      return { kind: 'complete', from };
    }
    if (lapped) {
      return { kind: 'loop', from, to: this.currentIndex, lap: this.currentLap };
    }
    return { kind: 'advance', from, to: this.currentIndex };
  }

  seek(i: number): void {
    const start = Number.isFinite(i)
      ? Math.max(0, Math.min(this.steps.length, Math.trunc(i)))
      : 0;
    this.currentIndex = this.findNextPlayable(start);
    this.satisfiedNotes.clear();
    this.prevCarried.clear();
    this.completions = [];
    this.beatOffset = 0;
  }

  reset(): void {
    if (this.loopRange) {
      this.setRange(this.loopRange.first, this.loopRange.last);
      return;
    }
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

  private completeStep(index: number, timeMs: number): void {
    this.completions.push({ timeMs, beat: this.steps[index].beat + this.beatOffset });
    if (this.completions.length > 8) {
      this.completions.shift();
    }
  }

  /** Step past `done`; wraps inside a loop range. Returns true on a wrap. */
  private moveOn(done: number): boolean {
    this.satisfiedNotes.clear();
    this.currentIndex = this.findNextPlayable(done + 1);
    const range = this.loopRange;
    if (!range || (!this.finished && this.currentIndex <= range.last)) {
      return false;
    }
    const first = this.findNextPlayable(range.first);
    // Pace across the wrap: count the last step as lasting one average step.
    const c = this.completions;
    const gap = c.length > 1 ? (c[c.length - 1].beat - c[0].beat) / (c.length - 1) : 1;
    this.beatOffset += this.steps[done].beat - this.steps[first].beat + (gap > 0 ? gap : 1);
    this.currentIndex = first;
    this.currentLap += 1;
    return true;
  }

  /** Pre-satisfy notes of the new step that `done` also asked for and still ring. */
  private carryOver(done: number, ringing: ReadonlySet<number>): number {
    const before = this.steps[done].notes;
    for (const note of this.steps[this.currentIndex].notes) {
      if (ringing.has(note) && before.includes(note)) {
        this.satisfiedNotes.add(note);
        this.prevCarried.add(note);
      }
    }
    return this.satisfiedNotes.size;
  }

  private findNextPlayable(start: number): number {
    let index = start;
    while (index < this.steps.length && this.steps[index].notes.length === 0) {
      index += 1;
    }
    return index;
  }
}
