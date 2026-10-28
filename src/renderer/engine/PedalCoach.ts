// #9976: JP's catch. Lifting the sustain pedal while only the pedal holds the sound,
// before the next note, leaves a silence. Correct legato pedalling strikes the next
// note first, then lifts. Telemetry only: it never gates the follower.

export interface PedalGap {
  gapMs: number;
  bar: number;
  step: number;
  nextNote: number;
}

export interface PedalCoachOptions {
  minGapMs?: number;
  maxGapMs?: number;
}

export class PedalCoach {
  private readonly minGapMs: number;
  private readonly maxGapMs: number;
  private liftAt: number | null = null;

  constructor(opts: PedalCoachOptions = {}) {
    this.minGapMs = opts.minGapMs ?? 120;
    this.maxGapMs = opts.maxGapMs ?? 3000;
  }

  /** Track sound stopped by a pedal lift. */
  pedal(
    down: boolean,
    timeMs: number,
    held: ReadonlySet<number>,
    ringing: ReadonlySet<number>
  ): void {
    if (down) {
      return;
    }

    this.liftAt = held.size === 0 && ringing.size > 0 ? timeMs : null;
  }

  /** Judge only the first note after a lift. */
  noteOn(
    midi: number,
    timeMs: number,
    ctx: { bar: number; step: number; restBefore: boolean }
  ): PedalGap | null {
    if (this.liftAt === null) {
      return null;
    }

    const gapMs = timeMs - this.liftAt;
    this.liftAt = null;

    if (
      gapMs > this.minGapMs &&
      gapMs < this.maxGapMs &&
      !ctx.restBefore
    ) {
      return {
        gapMs,
        bar: ctx.bar,
        step: ctx.step,
        nextNote: midi
      };
    }

    return null;
  }

  /** Forget any pending lift. */
  reset(): void {
    this.liftAt = null;
  }
}
