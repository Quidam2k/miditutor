import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { onSomeDisplay, sessionFiles } from '../src/main/sessionFiles';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'miditutor-session-'));
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

describe('sessionFiles (#10236)', () => {
  it('round trips the snapshot', async () => {
    const f = sessionFiles(dir);
    expect(await f.loadSession()).toEqual({ snapshot: null, force: false });
    await f.saveSession({ step: 7 });
    expect(await f.loadSession()).toEqual({ snapshot: { step: 7 }, force: false });
  });

  it('the marker forces one restore, then is gone', async () => {
    const f = sessionFiles(dir);
    await f.saveSession({ step: 1 });
    await fs.writeFile(path.join(dir, 'restore-next'), '');
    expect((await f.loadSession()).force).toBe(true);
    expect((await f.loadSession()).force).toBe(false);
  });

  it('the marker is used up even with no snapshot', async () => {
    const f = sessionFiles(dir);
    await fs.writeFile(path.join(dir, 'restore-next'), '');
    expect(await f.loadSession()).toEqual({ snapshot: null, force: true });
    await expect(fs.access(path.join(dir, 'restore-next'))).rejects.toThrow();
  });

  it('round trips the note trainer record (#5260), and leaves the marker alone', async () => {
    const f = sessionFiles(dir);
    expect(await f.loadNoteStats()).toBeNull();
    await fs.writeFile(path.join(dir, 'restore-next'), '');
    await f.saveNoteStats({ stats: { 'treble:C4': { attempts: 1 } } });
    expect(await f.loadNoteStats()).toEqual({ stats: { 'treble:C4': { attempts: 1 } } });
    await expect(fs.access(path.join(dir, 'restore-next'))).resolves.toBeUndefined();
  });

  it('a corrupt snapshot reads as none', async () => {
    await fs.writeFile(path.join(dir, 'session.json'), '{"step":');
    expect((await sessionFiles(dir).loadSession()).snapshot).toBeNull();
  });

  it('keeps only a well-formed window state', async () => {
    const f = sessionFiles(dir);
    expect(await f.loadWindow()).toBeNull();
    await f.saveWindow({ x: 1, y: 2, width: 900, height: 600, fullScreen: true });
    expect(await f.loadWindow()).toEqual({ x: 1, y: 2, width: 900, height: 600, fullScreen: true });
    for (const bad of ['nope', '{"x":1,"y":2,"width":900,"height":600}', '{"x":1,"y":2,"width":0,"height":600,"fullScreen":false}']) {
      await fs.writeFile(path.join(dir, 'window-state.json'), bad);
      expect(await f.loadWindow()).toBeNull();
    }
  });

  it('many saves at once leave the last one and no temp files', async () => {
    const f = sessionFiles(dir);
    await Promise.all(Array.from({ length: 20 }, (_, i) => f.saveSession({ step: i })));
    expect((await f.loadSession()).snapshot).toEqual({ step: 19 });
    expect(await fs.readdir(dir)).toEqual(['session.json']);
  });

  it('a failed save rejects and does not block the next one', async () => {
    const gone = path.join(dir, 'gone');
    const f = sessionFiles(gone);
    await expect(f.saveSession({ step: 1 })).rejects.toThrow();
    await fs.mkdir(gone);
    await f.saveSession({ step: 2 });
    expect((await f.loadSession()).snapshot).toEqual({ step: 2 });
  });
});

describe('onSomeDisplay', () => {
  const tv = { x: 0, y: 0, width: 1920, height: 1080 };
  it('is on the display, off it, or barely touching', () => {
    expect(onSomeDisplay({ x: 100, y: 100, width: 900, height: 600 }, [tv])).toBe(true);
    expect(onSomeDisplay({ x: 3000, y: 100, width: 900, height: 600 }, [tv])).toBe(false);
    expect(onSomeDisplay({ x: 1900, y: 100, width: 900, height: 600 }, [tv])).toBe(false);
    expect(onSomeDisplay({ x: 3000, y: 0, width: 900, height: 600 }, [tv, { x: 2920, y: 0, width: 1920, height: 1080 }])).toBe(true);
  });
});
