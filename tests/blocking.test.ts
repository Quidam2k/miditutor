// #5657c — Hand-position grouping and untimed blocking gates.

import { describe, expect, it } from 'vitest';
import {
  BLOCK_HOLDS,
  blockInput,
  blockLabel,
  current,
  groupPositions,
  showKeys,
  startBlocking,
  type BlockNote,
  type BlockState,
  type BlockStep,
  type Position,
} from '../src/renderer/engine/Blocking';

function note(
  midi: number,
  finger?: string,
  hand: 'L' | 'R' = 'R',
): BlockNote {
  return finger === undefined ? { midi, hand } : { midi, hand, finger };
}

function step(n: number, notes: BlockNote[], bar = 1): BlockStep {
  return { step: n, bar, notes };
}

function position(
  keys: number[],
  firstBar = 1,
  lastBar = firstBar,
): Position {
  return {
    firstStep: 0,
    lastStep: 0,
    firstBar,
    lastBar,
    keys,
    fingers: keys.map(midi => note(midi)),
  };
}

function input(s: BlockState, held: number[], pressed?: number) {
  return blockInput(s, new Set(held), pressed);
}

describe('groupPositions', () => {
  it('groups a five-finger RH melody into one position', () => {
    const keys = [60, 62, 64, 65, 67];
    const positions = groupPositions(
      keys.map((midi, index) =>
        step(index, [note(midi, String(index + 1))]),
      ),
    );

    expect(positions).toEqual([{
      firstStep: 0,
      lastStep: 4,
      firstBar: 1,
      lastBar: 1,
      keys,
      fingers: keys.map((midi, index) => note(midi, String(index + 1))),
    }]);
  });

  it('starts a position when a named finger moves', () => {
    const positions = groupPositions([
      step(0, [note(60, '1')]),
      step(1, [note(62, '2')]),
      step(2, [note(67, '1')], 2),
    ]);

    expect(positions.map(p => p.keys)).toEqual([[60, 62], [67]]);
    expect(positions[0]!.lastStep).toBe(1);
    expect(positions[1]!.firstStep).toBe(2);
    expect(positions[1]!.firstBar).toBe(2);
  });

  it('starts a position for finger substitution within the same hand', () => {
    const positions = groupPositions([
      step(0, [note(64, '3')]),
      step(1, [note(64, '1')]),
    ]);

    expect(positions.map(p => p.keys)).toEqual([[64], [64]]);
    expect(positions[1]!.firstStep).toBe(1);
  });

  it('keeps both hands together and treats their fingers independently', () => {
    const positions = groupPositions([
      step(0, [note(48, '1', 'L'), note(60, '1')]),
      step(1, [note(50, '2', 'L'), note(62, '2')]),
    ]);

    expect(positions).toHaveLength(1);
    expect(positions[0]!.keys).toEqual([48, 50, 60, 62]);
    expect(positions[0]!.fingers).toEqual([
      note(48, '1', 'L'),
      note(50, '2', 'L'),
      note(60, '1'),
      note(62, '2'),
    ]);
  });

  it('moves an entire two-hand step when one hand conflicts', () => {
    const positions = groupPositions([
      step(0, [note(48, '1', 'L'), note(60, '1')]),
      step(1, [note(50, '2', 'L'), note(67, '1')]),
    ]);

    expect(positions.map(p => p.keys)).toEqual([[48, 60], [50, 67]]);
    expect(positions[1]!.firstStep).toBe(1);
  });

  it('allows different named fingers on the same midi across hands', () => {
    const positions = groupPositions([
      step(0, [note(60, '3', 'L')]),
      step(1, [note(60, '1')]),
    ]);

    expect(positions).toHaveLength(1);
    expect(positions[0]!.fingers).toEqual([note(60, '3', 'L')]);
  });

  it('starts a position at the sixth distinct fingerless key in a hand', () => {
    const positions = groupPositions(
      [60, 62, 64, 65, 67, 69].map((midi, index) =>
        step(index, [note(midi)]),
      ),
    );

    expect(positions.map(p => p.keys)).toEqual([[60, 62, 64, 65, 67], [69]]);
    expect(positions[1]!.firstStep).toBe(5);
  });

  it('allows a fingerless span of 12 and splits when it exceeds 12', () => {
    const positions = groupPositions([
      step(0, [note(60)]),
      step(1, [note(72)]),
      step(2, [note(73)]),
    ]);

    expect(positions.map(p => p.keys)).toEqual([[60, 72], [73]]);
  });

  it('lets fingerless repeats join even after named notes exceed the limits', () => {
    const positions = groupPositions([
      step(0, [
        note(48, '1'),
        note(60, '2'),
        note(62, '3'),
        note(64, '4'),
        note(65, '5'),
        note(67, '6'),
      ]),
      step(1, [note(48)]),
    ]);

    expect(positions).toHaveLength(1);
    expect(positions[0]!.lastStep).toBe(1);
    expect(positions[0]!.keys).toEqual([48, 60, 62, 64, 65, 67]);
  });

  it('counts fingerless keys and spans separately for each hand', () => {
    const positions = groupPositions([
      step(0, [note(36, undefined, 'L'), note(60)]),
      step(1, [note(38, undefined, 'L'), note(62)]),
      step(2, [note(40, undefined, 'L'), note(64)]),
    ]);

    expect(positions).toHaveLength(1);
    expect(positions[0]!.keys).toEqual([36, 38, 40, 60, 62, 64]);
  });

  it('keeps a step atomic when its combined additions exceed five keys', () => {
    const positions = groupPositions([
      step(0, [note(60), note(62), note(64), note(65)]),
      step(1, [note(67), note(69)]),
    ]);

    expect(positions.map(p => p.keys)).toEqual([[60, 62, 64, 65], [67, 69]]);
  });

  it('keeps an oversized initial chord atomic', () => {
    const keys = [60, 62, 64, 65, 67, 69];
    expect(groupPositions([step(0, keys.map(midi => note(midi)))]))
      .toEqual([{
        ...position(keys),
        fingers: keys.map(midi => note(midi)),
      }]);
  });

  it('uses the first later finger name for a previously unnamed key', () => {
    const positions = groupPositions([
      step(0, [note(64)]),
      step(1, [note(64, '3')]),
      step(2, [note(64)]),
      step(3, [note(64, '3')]),
    ]);

    expect(positions).toHaveLength(1);
    expect(positions[0]!.fingers).toEqual([note(64, '3')]);
  });

  it('remembers a later finger name when checking subsequent conflicts', () => {
    const positions = groupPositions([
      step(0, [note(64)]),
      step(1, [note(64, '3')]),
      step(2, [note(67, '3')]),
    ]);

    expect(positions.map(p => p.keys)).toEqual([[64], [67]]);
  });

  it('ignores duplicate midi within a step and sorts distinct keys', () => {
    const positions = groupPositions([
      step(0, [note(67, '5'), note(60, '1'), note(60, '2')]),
    ]);

    expect(positions[0]!.keys).toEqual([60, 67]);
    expect(positions[0]!.fingers).toEqual([note(60, '1'), note(67, '5')]);
  });

  it('drops leading empty steps and extends positions with later empty steps', () => {
    const positions = groupPositions([
      step(0, [], 1),
      step(1, [note(60, '1')], 2),
      step(2, [], 3),
      step(3, [note(67, '1')], 4),
      step(4, [], 5),
    ]);

    expect(positions.map(p => [
      p.firstStep, p.lastStep, p.firstBar, p.lastBar,
    ])).toEqual([[1, 2, 2, 3], [3, 4, 4, 5]]);
  });

  it('returns no positions when there are no notes', () => {
    expect(groupPositions([])).toEqual([]);
    expect(groupPositions([step(0, []), step(1, [], 2)])).toEqual([]);
  });
});

describe('blocking input', () => {
  it('starts with default progress and ignores unrelated held keys', () => {
    const positions = [position([60, 64])];
    expect(startBlocking(positions, new Set([99]))).toEqual({
      positions,
      at: 0,
      clean: 0,
      need: BLOCK_HOLDS,
      armed: true,
      spoiled: false,
      done: false,
    });
    expect(BLOCK_HOLDS).toBe(3);
  });

  it('requires every position key to be up before an existing hold can count', () => {
    let state = startBlocking([position([60, 64])], new Set([60]));
    expect(state.armed).toBe(false);

    let result = input(state, [60, 64], 64);
    expect(result.event).toBe('none');
    expect(result.state.clean).toBe(0);

    result = input(result.state, [64]);
    expect(result.state.armed).toBe(false);

    result = input(result.state, []);
    expect(result.state.armed).toBe(true);

    result = input(result.state, [60], 60);
    expect(result.event).toBe('none');

    state = result.state;
    result = input(state, [60, 64], 64);
    expect(result.event).toBe('hold');
    expect(result.state.clean).toBe(1);
  });

  it('requires release between holds and advances after three clean holds', () => {
    let state = startBlocking(
      [position([60, 64]), position([67])],
      new Set(),
    );

    for (let count = 1; count <= 3; count += 1) {
      const result = input(state, [60, 64], 64);
      expect(result.event).toBe(count === 3 ? 'next' : 'hold');
      state = result.state;

      if (count < 3) {
        expect(state.clean).toBe(count);
        expect(state.armed).toBe(false);

        const repeated = input(state, [60, 64]);
        expect(repeated.event).toBe('none');
        expect(repeated.state.clean).toBe(count);

        const partial = input(repeated.state, [60]);
        expect(partial.state.armed).toBe(false);
        expect(partial.state.clean).toBe(count);

        state = input(partial.state, []).state;
        expect(state.armed).toBe(true);
      }
    }

    expect(state).toMatchObject({
      at: 1,
      clean: 0,
      armed: true,
      spoiled: false,
      done: false,
    });
  });

  it('spoils an attempt even if the wrong key releases before the hold', () => {
    const initial = {
      ...startBlocking([position([60, 64])], new Set()),
      clean: 1,
    };
    let result = input(initial, [99], 99);
    expect(result.event).toBe('wrong');
    expect(result.state.spoiled).toBe(true);

    result = input(result.state, []);
    expect(result.state.spoiled).toBe(true);

    result = input(result.state, [60], 60);
    expect(result.event).toBe('none');

    result = input(result.state, [60, 64], 64);
    expect(result.event).toBe('spoiled-hold');
    expect(result.state).toMatchObject({
      clean: 1,
      armed: false,
      spoiled: true,
    });

    result = input(result.state, [64]);
    expect(result.state.spoiled).toBe(true);
    expect(result.state.armed).toBe(false);

    result = input(result.state, []);
    expect(result.state).toMatchObject({
      clean: 1,
      armed: true,
      spoiled: false,
    });

    result = input(result.state, [60, 64], 64);
    expect(result.event).toBe('hold');
    expect(result.state.clean).toBe(2);
  });

  it('lets a spoiled hold take priority over a wrong event', () => {
    const state = startBlocking([position([60])], new Set());
    const result = input(state, [60, 99], 99);

    expect(result.event).toBe('spoiled-hold');
    expect(result.state.clean).toBe(0);
    expect(result.state.armed).toBe(false);
    expect(result.state.spoiled).toBe(true);
  });

  it('reports wrong while unarmed and clears spoil when position keys are up', () => {
    const state = startBlocking([position([60])], new Set([60]));
    const wrong = input(state, [60, 99], 99);

    expect(wrong.event).toBe('wrong');
    expect(wrong.state.armed).toBe(false);
    expect(wrong.state.spoiled).toBe(true);

    const released = input(wrong.state, [99]);
    expect(released.event).toBe('none');
    expect(released.state.armed).toBe(true);
    expect(released.state.spoiled).toBe(false);

    const rearmedByPress = input(state, [99], 99);
    expect(rearmedByPress.event).toBe('wrong');
    expect(rearmedByPress.state.armed).toBe(true);
    expect(rearmedByPress.state.spoiled).toBe(true);
  });

  it('starts a new position unarmed when it shares a held key', () => {
    const state = startBlocking(
      [position([60, 64]), position([64, 67])],
      new Set(),
      1,
    );
    let result = input(state, [60, 64], 64);

    expect(result.event).toBe('next');
    expect(result.state).toMatchObject({ at: 1, clean: 0, armed: false });

    result = input(result.state, [60, 64, 67], 67);
    expect(result.event).toBe('none');
    expect(result.state.clean).toBe(0);

    result = input(result.state, [64]);
    expect(result.state.armed).toBe(false);

    result = input(result.state, []);
    expect(result.state.armed).toBe(true);

    result = input(result.state, [64, 67], 67);
    expect(result.event).toBe('done');
    expect(result.state.done).toBe(true);
    expect(result.state.clean).toBe(1);
  });

  it('completes the last position after three clean holds', () => {
    let state = startBlocking([position([60])], new Set());

    for (let count = 1; count <= 3; count += 1) {
      const result = input(state, [60], 60);
      expect(result.event).toBe(count === 3 ? 'done' : 'hold');
      state = result.state;
      if (count < 3) state = input(state, []).state;
    }

    expect(state.done).toBe(true);
    expect(state.clean).toBe(3);
    expect(state.armed).toBe(false);

    const ignored = input(state, [99], 99);
    expect(ignored.event).toBe('none');
    expect(ignored.state).toBe(state);
  });

  it('starts empty practice complete and ignores input', () => {
    const state = startBlocking([], new Set([60]));
    expect(state).toMatchObject({
      at: 0,
      clean: 0,
      armed: true,
      spoiled: false,
      done: true,
    });
    expect(input(state, [99], 99)).toEqual({ state, event: 'none' });
  });

  it('leaves the previous state and held set unchanged', () => {
    const state = startBlocking([position([60])], new Set());
    const before = {
      ...state,
      positions: state.positions.map(p => ({
        ...p,
        keys: p.keys.slice(),
        fingers: p.fingers.map(n => ({ ...n })),
      })),
    };
    const held = new Set([60]);
    const result = blockInput(state, held, 60);

    expect(result.state).not.toBe(state);
    expect(state).toEqual(before);
    expect([...held]).toEqual([60]);
  });
});

describe('blocking helpers', () => {
  it('returns the active position and null after completion', () => {
    const positions = [position([60]), position([64])];
    const state = startBlocking(positions, new Set());

    expect(current(state)).toBe(positions[0]);
    expect(current({ ...state, at: 1 })).toBe(positions[1]);
    expect(current({ ...state, done: true })).toBeNull();
    expect(current(startBlocking([], new Set()))).toBeNull();
  });

  it('labels single bars, bar ranges, and completed practice', () => {
    const positions = Array.from({ length: 7 }, () => position([60], 3));
    const state = startBlocking(positions, new Set());

    expect(blockLabel(state))
      .toBe('Blocking: position 1/7 · bar 3 · hold 0/3');

    const ranged = {
      ...state,
      at: 1,
      clean: 1,
      positions: positions.map((p, index) =>
        index === 1 ? { ...p, lastBar: 4 } : p,
      ),
    };
    expect(blockLabel(ranged))
      .toBe('Blocking: position 2/7 · bars 3–4 · hold 1/3');
    expect(blockLabel({ ...ranged, done: true }))
      .toBe('Blocking: all 7 positions held clean');
    expect(blockLabel({ ...state, need: 5 }))
      .toBe('Blocking: position 1/7 · bar 3 · hold 0/5');
  });

  it('shows hints initially, while hesitating, or during a spoiled attempt', () => {
    const state = startBlocking([position([60])], new Set());
    expect(showKeys(state, false)).toBe(true);

    const practiced = { ...state, clean: 1 };
    expect(showKeys(practiced, false)).toBe(false);
    expect(showKeys(practiced, true)).toBe(true);
    expect(showKeys({ ...practiced, spoiled: true }, false)).toBe(true);
    expect(showKeys({ ...practiced, spoiled: true }, true)).toBe(true);
  });
});
