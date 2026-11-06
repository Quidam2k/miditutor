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

// #5516: a key struck this soon after the strike that finished a step, and not part of
// that step, is a graze (his 11/4 log: grazes 7-59 ms, real next notes >= 316 ms).
export const GRAZE_MS = 80;

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
  // #5516: a graze (too soon after the last step) or a key under the velocity floor.
  // Never credited and never resets the step; it only spoils a clean lap.
  | { kind: 'stray'; index: number; played: number; reason: 'graze' | 'soft' }
  | { kind: 'ignored' };

/**
 * #10136: the tie continuations to colour as played when the cursor moves from step
 * `from` to `to`: those in the steps it passed into (empty steps included) whose pitch
 * he is still sounding (key down, or let go under the pedal). `ties[i]` = the MIDI
 * pitches tied over into step i. After a lap wrap, pass from = the loop's first step - 1.
 */
export function heldTies(
  ties: number[][],
  from: number,
  to: number,
  sounding: ReadonlySet<number>,
): Array<{ step: number; index: number }> {
  const out: Array<{ step: number; index: number }> = [];
  for (let step = from + 1; step <= to; step++) {
    (ties[step] ?? []).forEach((midi, index) => {
      if (sounding.has(midi)) out.push({ step, index });
    });
  }
  return out;
}

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
  // #5568: written notes still sounding at the step he just finished (a tied chord he
  // strikes a moment after the melody note that finished the step). Not wrong, and not
  // a graze, at the next step, until he plays on.
  private prevRinging = new Set<number>();
  // #9999: notes of the current step that may carry, decided at his next strike.
  private pendingCarry = new Set<number>();
  // #9994: set by a wrong note on this step; credit then counts only a clean chord.
  private missed = false;
  private lastHitMs = -Infinity;
  // #5516: when a strike last finished a step (not a carry settled at a later strike).
  private lastFinishMs = -Infinity;
  /** #5516: graze window in ms; 0 turns it off. */
  grazeMs = GRAZE_MS;
  /** #5516: velocity floor (1-127); 0 = off. A softer key is a stray. */
  minVelocity = 0;

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

  /** #10236: a relaunch puts him back on the lap he was on. */
  restoreLap(lap: number): void {
    this.currentLap = lap;
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

  noteOn(midi: number, timeMs: number, sounding: ReadonlySet<number> = new Set(), velocity = 127): FollowResult {
    const held = new Set(sounding);
    held.delete(midi);
    // #5516: judged before carries settle, so a graze can never complete a step or a lap.
    const stray = this.strayCheck(midi, timeMs, velocity);
    if (stray === 'bounce') return { kind: 'ignored' };
    if (stray) return { kind: 'stray', index: this.currentIndex, played: midi, reason: stray };
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
      if (this.harmless(midi)) return { kind: 'ignored' };
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
    this.prevRinging.clear();
    this.lastHitMs = timeMs;

    if (this.satisfiedNotes.size < expected.length) {
      return { kind: 'partial', index: this.currentIndex, remaining: this.remainingAt(expected) };
    }

    // The key that just finished this step is not carried: a repeated written note
    // (Auld Lang Syne's F4 F4) must be struck again (#9630). `held` already lacks it.
    const from = this.currentIndex;
    this.lastFinishMs = timeMs;
    const lapped = this.finishStep(timeMs, held);

    if (this.finished) {
      return { kind: 'complete', from };
    }
    if (lapped) {
      return { kind: 'loop', from, to: this.currentIndex, lap: this.currentLap };
    }
    return { kind: 'advance', from, to: this.currentIndex };
  }

  /**
   * #5516: would this strike be a stray? 'graze' = another key within grazeMs of the
   * strike that finished the last step; 'soft' = under the velocity floor; 'bounce' = the
   * same key again inside the window (a double trigger: no credit, no penalty). Call it
   * before settle(): a stray must not confirm a carry.
   */
  strayCheck(midi: number, timeMs: number, velocity = 127): 'graze' | 'soft' | 'bounce' | null {
    if (this.finished || this.satisfiedNotes.has(midi)) return null;
    const inWindow = this.grazeMs > 0 && timeMs - this.lastFinishMs < this.grazeMs;
    if (inWindow && this.prevStruck.has(midi)) return 'bounce';
    if (!this.steps[this.currentIndex].notes.includes(midi) && this.harmless(midi)) return null;
    if (inWindow) return 'graze';
    if (this.minVelocity > 0 && velocity < this.minVelocity) return 'soft';
    return null;
  }

  /** Not asked for here, but no mistake: carried, just struck, or still ringing. */
  private harmless(midi: number): boolean {
    return this.prevCarried.has(midi) || this.prevStruck.has(midi) || this.prevRinging.has(midi) ||
      !!this.steps[this.currentIndex].ringing?.includes(midi);
  }

  seek(i: number): void {
    const start = Number.isFinite(i)
      ? Math.max(0, Math.min(this.steps.length, Math.trunc(i)))
      : 0;
    this.currentIndex = this.findNextPlayable(start);
    this.satisfiedNotes.clear();
    this.prevCarried.clear();
    this.prevStruck.clear();
    this.prevRinging.clear();
    this.pendingCarry.clear();
    this.missed = false;
    this.lastFinishMs = -Infinity;
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
    this.prevRinging = new Set(this.steps[done].ringing ?? []);
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
