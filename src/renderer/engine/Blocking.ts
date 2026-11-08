// #5657c: block a passage in hand positions (JP homework 11/6: "block your fingers in hand
// positions"). Each position is pressed as one chord, held, let go; three clean holds and
// it moves to the next. No timing at all.

export interface BlockNote {
  midi: number;
  hand: 'L' | 'R';
  finger?: string;
}

export interface BlockStep {
  step: number;
  bar: number;
  notes: BlockNote[];
}

export interface Position {
  firstStep: number;
  lastStep: number;
  firstBar: number;
  lastBar: number;
  keys: number[];
  fingers: { midi: number; hand: 'L' | 'R'; finger?: string }[];
}

export interface BlockState {
  positions: Position[];
  at: number;
  clean: number;
  need: number;
  armed: boolean;
  spoiled: boolean;
  done: boolean;
}

export type BlockEvent =
  | 'none'
  | 'wrong'
  | 'hold'
  | 'spoiled-hold'
  | 'next'
  | 'done';

export const BLOCK_HOLDS = 3;

interface PositionDraft {
  position: Position;
  notes: BlockNote[];
}

/** Check the whole step against the accumulated hand positions. */
function needsPosition(draft: PositionDraft, notes: BlockNote[]): boolean {
  const seen = draft.notes.slice();
  const keys = new Set(draft.position.keys);

  for (const note of notes) {
    const handNotes = seen.filter(previous => previous.hand === note.hand);

    if (note.finger !== undefined) {
      const conflict = handNotes.some(previous =>
        previous.finger !== undefined &&
        (
          (previous.finger === note.finger && previous.midi !== note.midi) ||
          (previous.midi === note.midi && previous.finger !== note.finger)
        )
      );
      if (conflict) return true;
    } else if (!keys.has(note.midi)) {
      const handKeys = new Set(handNotes.map(previous => previous.midi));
      handKeys.add(note.midi);

      let low = note.midi;
      let high = note.midi;
      for (const midi of handKeys) {
        low = Math.min(low, midi);
        high = Math.max(high, midi);
      }
      if (handKeys.size > 5 || high - low > 12) return true;
    }

    seen.push(note);
    keys.add(note.midi);
  }

  return false;
}

/** Extend a draft without changing its previous contents. */
function appendStep(
  draft: PositionDraft | null,
  step: BlockStep,
  notes: BlockNote[],
): PositionDraft {
  const byMidi = new Map<number, BlockNote>(
    draft?.position.fingers.map(note => [note.midi, note] as const) ?? [],
  );

  for (const note of notes) {
    const previous = byMidi.get(note.midi);
    if (
      previous === undefined ||
      (previous.finger === undefined && note.finger !== undefined)
    ) {
      byMidi.set(note.midi, { ...note });
    }
  }

  const fingers = Array.from(byMidi.values()).sort((a, b) => a.midi - b.midi);

  return {
    position: {
      firstStep: draft?.position.firstStep ?? step.step,
      lastStep: step.step,
      firstBar: draft?.position.firstBar ?? step.bar,
      lastBar: step.bar,
      keys: fingers.map(note => note.midi),
      fingers,
    },
    notes: [...(draft?.notes ?? []), ...notes],
  };
}

/** Group atomic follower steps into hand positions. */
export function groupPositions(steps: BlockStep[]): Position[] {
  const positions: Position[] = [];
  let draft: PositionDraft | null = null;

  for (const step of steps) {
    const seen = new Set<number>();
    const notes = step.notes.filter(note => {
      if (seen.has(note.midi)) return false;
      seen.add(note.midi);
      return true;
    });

    if (notes.length === 0) {
      if (draft !== null) draft = appendStep(draft, step, notes);
      continue;
    }

    if (draft !== null && needsPosition(draft, notes)) {
      positions.push(draft.position);
      draft = null;
    }

    draft = appendStep(draft, step, notes);
  }

  if (draft !== null) positions.push(draft.position);
  return positions;
}

/** Start practice, requiring any already-held position keys to release. */
export function startBlocking(
  positions: Position[],
  held: ReadonlySet<number>,
  need = BLOCK_HOLDS,
): BlockState {
  return {
    positions,
    at: 0,
    clean: 0,
    need,
    armed: !(positions[0]?.keys ?? []).some(key => held.has(key)),
    spoiled: false,
    done: positions.length === 0,
  };
}

/** Process one press or release without changing the previous state. */
export function blockInput(
  s: BlockState,
  held: ReadonlySet<number>,
  pressed?: number,
): { state: BlockState; event: BlockEvent } {
  if (s.done) return { state: s, event: 'none' };

  const keys = s.positions[s.at]!.keys;
  let { at, clean, armed, spoiled } = s;
  let done: boolean = s.done;
  let event: BlockEvent = 'none';

  if (pressed !== undefined && !keys.includes(pressed)) {
    spoiled = true;
    event = 'wrong';
  }

  if (!armed) {
    if (!keys.some(key => held.has(key))) {
      armed = true;
      // A fresh attempt, unless the press that let it start was itself a wrong key.
      spoiled = event === 'wrong';
    }
    return { state: { ...s, armed, spoiled }, event };
  }

  if (keys.every(key => held.has(key))) {
    armed = false;

    if (spoiled) {
      event = 'spoiled-hold';
    } else {
      clean += 1;
      if (clean < s.need) {
        event = 'hold';
      } else if (at === s.positions.length - 1) {
        done = true;
        event = 'done';
      } else {
        at += 1;
        clean = 0;
        spoiled = false;
        armed = !s.positions[at]!.keys.some(key => held.has(key));
        event = 'next';
      }
    }
  }

  return { state: { ...s, at, clean, armed, spoiled, done }, event };
}

/** Return the active position, or null after completion. */
export function current(s: BlockState): Position | null {
  return s.done ? null : s.positions[s.at] ?? null;
}

/** Describe progress without timing information. */
export function blockLabel(s: BlockState): string {
  if (s.done) {
    return `Blocking: all ${s.positions.length} positions held clean`;
  }

  const position = s.positions[s.at]!;
  const bars = position.firstBar === position.lastBar
    ? `bar ${position.firstBar}`
    : `bars ${position.firstBar}–${position.lastBar}`;

  return `Blocking: position ${s.at + 1}/${s.positions.length} · ${bars} · hold ${s.clean}/${s.need}`;
}

/** Show hints until a clean hold, or when assistance is needed. */
export function showKeys(s: BlockState, hesitating: boolean): boolean {
  return s.clean === 0 || hesitating || s.spoiled;
}

