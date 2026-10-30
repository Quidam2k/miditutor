// #10236 seamless relaunch: the files in userData that put him back where he was.
// session.json = the renderer's practice snapshot; window-state.json = where the window was;
// restore-next = a marker deploy_pinocchio.sh leaves before quitting the app, meaning
// "this launch is a patch: restore however old the snapshot is".
import fs from 'node:fs/promises';
import path from 'node:path';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface WindowState extends Rect {
  fullScreen: boolean;
}

let tempSeq = 0;
// Per target, so an older save can never land on top of a newer one, even from two callers.
const queues = new Map<string, Promise<unknown>>();

// Whole file or nothing: a kill mid-write leaves the last good one.
function saveJson(file: string, value: unknown): Promise<void> {
  const run = async () => {
    const temp = `${file}.${process.pid}.${++tempSeq}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(value), 'utf8');
      await fs.rename(temp, file);
    } catch (err) {
      await fs.rm(temp, { force: true }).catch(() => undefined);
      throw err;
    }
  };
  const done = (queues.get(file) ?? Promise.resolve()).then(run, run);
  queues.set(file, done);
  return done;
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n);

export function sessionFiles(dir: string) {
  const sessionFile = path.join(dir, 'session.json');
  const windowFile = path.join(dir, 'window-state.json');
  const marker = path.join(dir, 'restore-next');
  return {
    saveSession: (value: unknown) => saveJson(sessionFile, value),
    saveWindow: (state: WindowState) => saveJson(windowFile, state),

    /** force = the marker was there; it's used up by this read. */
    async loadSession(): Promise<{ snapshot: unknown; force: boolean }> {
      const force = await fs.access(marker).then(() => true, () => false);
      if (force) await fs.rm(marker, { force: true }).catch(() => undefined);
      return { snapshot: await readJson(sessionFile), force };
    },

    async loadWindow(): Promise<WindowState | null> {
      const s = (await readJson(windowFile)) as Partial<WindowState> | null;
      if (!s || !finite(s.x) || !finite(s.y) || !finite(s.width) || !finite(s.height)) return null;
      if ((s.width as number) <= 0 || (s.height as number) <= 0 || typeof s.fullScreen !== 'boolean') return null;
      return { x: s.x as number, y: s.y as number, width: s.width as number, height: s.height as number, fullScreen: s.fullScreen };
    },
  };
}

/** Enough of the window is on one display to grab it; not so if the TV it was on is gone. */
export function onSomeDisplay(bounds: Rect, displays: Rect[]): boolean {
  return displays.some((d) => {
    const w = Math.min(bounds.x + bounds.width, d.x + d.width) - Math.max(bounds.x, d.x);
    const h = Math.min(bounds.y + bounds.height, d.y + d.height) - Math.max(bounds.y, d.y);
    return w >= 100 && h >= 50;
  });
}
