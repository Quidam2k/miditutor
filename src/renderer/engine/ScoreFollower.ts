// Milestone 2: pure score-following matcher. The Score view extracts one ScoreStep per
// OSMD cursor position; this decides when the cursor may advance. No DOM / OSMD here.
// #5004: an optional loop range wraps back to its first step instead of finishing.
// #9480/#9999: a key held from the step he just finished that the next step asks for
// again is carried over, so he need not re-strike it, but only if it is STILL held
// when he strikes his next note. A chord's normal release then never skips a written
// repeat (Sorcerer's Apprentice bar 29, C5 C5 C5).

// #9994: after a wrong note, the step needs all its notes struck together, each within
// this long of the one before (GestureTracker's chord window), with no wrong key between.
export const CHORD_WINDOW_MS = 120;

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
  // remaining = the expected notes not yet played at this step (#9986: name only those).
  | { kind: 'wrong'; index: number; played: number; expected: number[]; remaining: number[] }
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
  // #9993: the chord he just finished. He replays a whole chord after a miss, so a
  // note of it landing just after the advance is not wrong, until he plays on.
  private prevStruck = new Set<number>();
  // #9999: notes of the current step that may carry, decided at his next strike.
  private pendingCarry = new Set<number>();
  // #9994: set by a wrong note on this step; credit then counts only a clean chord.
  private missed = false;
  private lastHitMs = -Infinity;

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
  /**
   * #9999: settle carry-overs before judging a strike. `held` = keys down right now,
   * excluding the one being struck. A step made only of still-held notes completes
   * here. Returns how the cursor moved, or null if it did not.
   */
  settle(timeMs: number, held: ReadonlySet<number>): FollowResult | null {
    const from = this.currentIndex;
    let lapped = false;
    for (let guard = 0; guard <= this.steps.length && this.pendingCarry.size > 0 && !this.finished; guard++) {
      for (const note of this.pendingCarry) {
        if (!held.has(note)) continue;
        this.satisfiedNotes.add(note);
        this.prevCarried.add(note);
      }
      this.pendingCarry.clear();
      if (this.satisfiedNotes.size < this.steps[this.currentIndex].notes.length) break;
      if (this.finishStep(timeMs, held)) {
        lapped = true;
        break;
      }
    }
    if (this.currentIndex === from && !lapped) return null;
    if (this.finished) return { kind: 'complete', from };
    if (lapped) return { kind: 'loop', from, to: this.currentIndex, lap: this.currentLap };
    return { kind: 'advance', from, to: this.currentIndex };
  }

  noteOn(midi: number, timeMs: number, sounding: ReadonlySet<number> = new Set()): FollowResult {
    const held = new Set(sounding);
    held.delete(midi);
    this.settle(timeMs, held);
    if (this.finished) {
      return { kind: 'ignored' };
    }

    // A loop over bars with nothing to play (all rests): nothing to follow.
    if (this.loopRange && this.findNextPlayable(this.loopRange.first) > this.loopRange.last) {
      return { kind: 'ignored' };
    }

    const expected = this.steps[this.currentIndex].notes;

    // After a miss, a note too long after the last one starts a new attempt.
    if (this.missed && timeMs - this.lastHitMs > CHORD_WINDOW_MS) this.restartAttempt();

    if (this.satisfiedNotes.has(midi)) {
      return { kind: 'ignored' };
    }

    if (!expected.includes(midi)) {
      if (
        this.prevCarried.has(midi) ||
        this.prevStruck.has(midi) ||
        this.steps[this.currentIndex].ringing?.includes(midi)
      ) {
        return { kind: 'ignored' };
      }
      // A miss resets the step: piecemeal credit from before it no longer counts.
      this.missed = true;
      this.restartAttempt();
      return {
        kind: 'wrong',
        index: this.currentIndex,
        played: midi,
        expected: [...expected],
        remaining: this.remainingAt(expected)
      };
    }

    this.satisfiedNotes.add(midi);
    this.prevStruck.clear();
    this.lastHitMs = timeMs;

    if (this.satisfiedNotes.size < expected.length) {
      return { kind: 'partial', index: this.currentIndex, remaining: this.remainingAt(expected) };
    }

    // The key that just finished this step is not carried: a repeated written note
    // (Auld Lang Syne's F4 F4) must be struck again (#9630). `held` already lacks it.
    const from = this.currentIndex;
    const lapped = this.finishStep(timeMs, held);

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
    this.prevStruck.clear();
    this.pendingCarry.clear();
    this.missed = false;
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
    this.pendingCarry.clear();
    this.missed = false;
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

  /**
   * Complete the current step and move on; returns true on a lap wrap. Notes the new
   * step shares with it that are held now may carry, checked at the next strike.
   */
  private finishStep(timeMs: number, held: ReadonlySet<number>): boolean {
    const done = this.currentIndex;
    this.completeStep(done, timeMs);
    this.prevCarried.clear();
    for (const note of this.steps[done].notes) this.prevStruck.add(note);
    // Never carry across a lap wrap: the note just struck would cover its own step.
    if (this.moveOn(done)) return true;
    if (!this.finished) {
      const before = this.steps[done].notes;
      for (const note of this.steps[this.currentIndex].notes) {
        if (held.has(note) && before.includes(note)) this.pendingCarry.add(note);
      }
    }
    return false;
  }

  /** Back to only what is carried over (held keys); struck credit is dropped. */
  private restartAttempt(): void {
    this.satisfiedNotes = new Set(this.steps[this.currentIndex].notes.filter((n) => this.prevCarried.has(n)));
  }

  private remainingAt(expected: number[]): number[] {
    return expected.filter((note) => !this.satisfiedNotes.has(note)).sort((a, b) => a - b);
  }

  private findNextPlayable(start: number): number {
    let index = start;
    while (index < this.steps.length && this.steps[index].notes.length === 0) {
      index += 1;
    }
    return index;
  }
}
