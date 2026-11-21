// #6654: where his fingering edits are written. Any plain file stem in the Pieces folder may be
// saved (pushed pieces are named by title: "The Sorcerer's Apprentice.musicxml"), but only a
// real file directly inside that folder: no separators, no dot files, no .pre-* backups, and
// no symlink or junction that resolves anywhere else.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { isNoteMark } from '../shared/fingering';
import { isPieceFileName } from '../shared/pieceFiles';

/** Errors the renderer treats as final (drop the queued edit and say so) rather than retry. */
export const BAD_PIECE = 'bad piece name';
export const NO_PIECE = 'no such piece';

const caseFolds = process.platform === 'darwin' || process.platform === 'win32';

/** Absolute path of `<stem>.musicxml` inside `dir`, after following links; throws BAD_PIECE / NO_PIECE. */
export async function resolveScoreFile(dir: string, stem: unknown, foldCase = caseFolds): Promise<string> {
  if (
    typeof stem !== 'string' || !stem || stem.length > 200 || stem.trim() !== stem ||
    /[\\/\0]/.test(stem) || stem.startsWith('.') || path.basename(stem) !== stem
  ) {
    throw new Error(BAD_PIECE);
  }
  const name = `${stem}.musicxml`;
  if (!isPieceFileName(name)) throw new Error(BAD_PIECE);
  const realDir = await fs.realpath(dir);
  let real: string;
  try {
    real = await fs.realpath(path.join(dir, name));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(NO_PIECE);
    throw err;
  }
  const fold = (p: string) => (foldCase ? p.toLowerCase() : p);
  if (fold(path.dirname(real)) !== fold(realDir)) throw new Error(BAD_PIECE);
  // A link to a backup in the same folder is still a backup.
  if (!isPieceFileName(path.basename(real))) throw new Error(BAD_PIECE);
  if (!(await fs.stat(real)).isFile()) throw new Error(BAD_PIECE);
  return real;
}

let tmpSeq = 0;

/** Runs tasks one after another: score writes and queue changes never overlap (Electron runs handlers concurrently). */
export function serial() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.catch(() => undefined).then(task);
    tail = run;
    return run;
  };
}

/**
 * Todd's rule (msg 65534): back things up before replacing them. Before the first change of a
 * day to a score, copy it to <root>/<day>/<name>; later changes that day leave that copy alone,
 * so it is always the file as it was when the day began. Returns the copy, or null if there was
 * nothing to copy or a copy for today already exists.
 */
export async function backupOnce(file: string, root: string, day: string): Promise<string | null> {
  const copy = path.join(root, day, path.basename(file));
  const tmp = `${copy}.${process.pid}.${++tmpSeq}.tmp`;
  try {
    await fs.mkdir(path.dirname(copy), { recursive: true });
    // Whole copy under a temp name first, then linked in only if today's copy is missing, so a
    // half-written copy can never become the day's backup.
    await fs.copyFile(file, tmp);
    await fs.link(tmp, copy);
    return copy;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // A copy for today already, or no file yet: nothing to keep. Anything else must never stop
    // the save itself: say so and go on.
    if (code !== 'EEXIST' && code !== 'ENOENT') console.warn(`[pieces] backup of ${path.basename(file)} failed: ${(err as Error).message}`);
    return null;
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
  }
}

/** Write via a temp file in the same folder and rename, so a crash never leaves half a file. */
export async function writeFileAtomic(file: string, text: string): Promise<void> {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.${++tmpSeq}.tmp`);
  try {
    await fs.writeFile(tmp, text, 'utf8');
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

/** One finger edit that could not be saved yet, kept by note position (#6654). */
export interface UnsavedEdit {
  /** The piece's file stem. */
  stem: string;
  measure: number;
  staff: number;
  onset: number;
  midi: number;
  /** The digit, or null to remove the mark; #6661 'hold' / 'unhold' = the tie-to-previous mark. */
  digit: string | null;
  /** Note name for messages ("F2"). */
  name?: string;
  /** When it was queued (main's clock). */
  at: number;
  /** The score file's mtime when queued: if the file changed since (a sync), the edit is stale. */
  mtimeMs?: number;
  /** Failed retries so far. */
  tries?: number;
}

/** After this many failed retries an edit is dropped and named, not retried forever. */
export const MAX_TRIES = 5;

const isEdit = (e: unknown): e is UnsavedEdit => {
  const o = e as UnsavedEdit;
  if (o && o.mtimeMs !== undefined && typeof o.mtimeMs !== 'number') return false;
  return !!o && typeof o.stem === 'string' && isNoteMark(o.digit) &&
    [o.measure, o.staff, o.onset, o.midi].every((n) => typeof n === 'number' && Number.isFinite(n));
};

/** The queue file; missing or unreadable reads as empty (a bad file is kept aside, not lost). */
export async function readUnsaved(file: string): Promise<UnsavedEdit[]> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch {
    return [];
  }
  try {
    const data = JSON.parse(text) as unknown;
    return Array.isArray(data) ? data.filter(isEdit) : [];
  } catch {
    await fs.rename(file, `${file}.bad-${Date.now()}`).catch(() => undefined);
    return [];
  }
}

export async function writeUnsaved(file: string, edits: unknown): Promise<void> {
  const list = Array.isArray(edits) ? edits.filter(isEdit) : [];
  if (list.length === 0) {
    await fs.rm(file, { force: true });
    return;
  }
  await writeFileAtomic(file, JSON.stringify(list, null, 1));
}

type NewEdit = Omit<UnsavedEdit, 'stem' | 'at' | 'mtimeMs' | 'tries'>;

/**
 * The queue, owned by main: every change is read-modify-write inside one serial chain, so two
 * failing saves can never drop each other's edits.
 */
export class UnsavedQueue {
  private readonly run = serial();

  constructor(private readonly file: string, private readonly piecesDir: () => string) {}

  private async mtime(stem: string): Promise<number | undefined> {
    try {
      return (await fs.stat(await resolveScoreFile(this.piecesDir(), stem))).mtimeMs;
    } catch {
      return undefined;
    }
  }

  /** Queue edits for one piece; returns how many wait for it now. */
  add(stem: string, edits: NewEdit[]): Promise<number> {
    return this.run(async () => {
      const at = Date.now();
      const mtimeMs = await this.mtime(stem);
      const all = [...(await readUnsaved(this.file)), ...edits.map((e) => ({ ...e, stem, at, mtimeMs, tries: 0 }))];
      await writeUnsaved(this.file, all);
      return all.filter((e) => e.stem === stem).length;
    });
  }

  /** This piece's waiting edits, split into ones still for this file and ones the file has changed under. */
  for(stem: string): Promise<{ edits: UnsavedEdit[]; stale: UnsavedEdit[] }> {
    return this.run(async () => {
      const mine = (await readUnsaved(this.file)).filter((e) => e.stem === stem);
      const now = await this.mtime(stem);
      const fresh = (e: UnsavedEdit) => now !== undefined && (e.mtimeMs === undefined || Math.abs(e.mtimeMs - now) < 1);
      return { edits: mine.filter(fresh), stale: mine.filter((e) => !fresh(e)) };
    });
  }

  /** Remove this piece's edits queued at or before `upTo` (all of them when null); returns how many are left. */
  clear(stem: string, upTo: number | null): Promise<number> {
    return this.run(async () => {
      const all = await readUnsaved(this.file);
      const keep = all.filter((e) => e.stem !== stem || (upTo !== null && e.at > upTo));
      if (keep.length !== all.length) await writeUnsaved(this.file, keep);
      return keep.filter((e) => e.stem === stem).length;
    });
  }

  /** A retry failed: count it, drop edits past MAX_TRIES. Returns how many still wait and which were dropped. */
  failed(stem: string): Promise<{ left: number; dropped: UnsavedEdit[] }> {
    return this.run(async () => {
      const all = (await readUnsaved(this.file)).map((e) => (e.stem === stem ? { ...e, tries: (e.tries ?? 0) + 1 } : e));
      const dropped = all.filter((e) => e.stem === stem && (e.tries ?? 0) >= MAX_TRIES);
      const keep = all.filter((e) => !dropped.includes(e));
      await writeUnsaved(this.file, keep);
      return { left: keep.filter((e) => e.stem === stem).length, dropped };
    });
  }
}
