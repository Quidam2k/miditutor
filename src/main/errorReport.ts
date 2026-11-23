// #6771 (asg 14108/14112): every MidiTutor error reaches Pantheon by itself, so Todd never has to
// stop playing to report one. Dedup, scrub (no note or score content leaves the box), an on-disk
// outbox for when Pantheon can't be reached, and one sender. Never throws, never reports itself.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface AppError {
  where: string;
  message: string;
  piece?: string | null;
  stack?: string | null;
}

export interface ErrorEvent {
  timestamp: string; // ISO
  tag: 'MidiTutorError';
  level: 'E';
  message: string; // `${where}: ${message}` after scrub, max 500 chars
  seq: number; // monotonic per session, from 1
  extras: {
    where: string;
    piece: string | null;
    stack: string | null;
    version: string;
    machine: string;
    count: number;
  };
}

export type OutboxLine = ErrorEvent & { session_id: string };

export interface ReporterOptions {
  outboxPath: string;
  send: (events: ErrorEvent[], sessionId: string) => Promise<{ ok: boolean; error?: string }>;
  log?: (event: ErrorEvent) => void;
  version: string;
  machine: string;
  now?: () => number;
  dedupMs?: number;
  cap?: number;
  retryMs?: number;
  sendTimeoutMs?: number;
}

const MAX_MESSAGE = 500;
const MAX_STACK = 2000;
const MAX_STACK_LINES = 15;
const MAX_BATCH = 50;
const MAX_DEDUP_ENTRIES = 500;
const WARN_INTERVAL_MS = 60_000;

// Module-level throttle: at most one console.warn per 60 s across all reporters.
// Never calls report().
let lastWarnAt = -Infinity;
function warn(e: unknown): void {
  try {
    const t = Date.now();
    if (t - lastWarnAt < WARN_INTERVAL_MS) return;
    lastWarnAt = t;
    console.warn('[errorReport] internal error:', e instanceof Error ? e.message : String(e));
  } catch {
    // nothing left to do
  }
}

const XML_TAG = '<\\/?[A-Za-z?!][^<>]*>';
const XML_RUN = new RegExp(`${XML_TAG}(?:\\s*${XML_TAG})*`, 'g');

// Replacements shared by scrub() and the stack scrubber (no whitespace handling, no cut).
function redact(text: string): string {
  return text
    .replace(/\/Users\/[^/\s]+\//g, '~/')
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+\\/g, '~/')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer ***')
    .replace(XML_RUN, '<xml>');
}

export function scrub(text: string): string {
  const s = typeof text === 'string' ? text : String(text);
  return redact(s).replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE);
}

function scrubStack(stack: string): string {
  return redact(stack)
    .split(/\r?\n/)
    .slice(0, MAX_STACK_LINES)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0)
    .join('\n')
    .slice(0, MAX_STACK);
}

function isAppError(x: unknown): x is AppError {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  return typeof o.where === 'string' && typeof o.message === 'string';
}

function safeString(x: unknown): string {
  try {
    return String(x);
  } catch {
    return '[unprintable]';
  }
}

function parseLines(raw: string): OutboxLine[] {
  const out: OutboxLine[] = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t) as OutboxLine;
      if (
        o &&
        typeof o === 'object' &&
        typeof o.seq === 'number' &&
        typeof o.session_id === 'string' &&
        typeof o.message === 'string' &&
        o.extras &&
        typeof o.extras === 'object'
      ) {
        out.push(o);
      }
    } catch {
      // corrupt line: skipped
    }
  }
  return out;
}

function serialize(lines: OutboxLine[]): string {
  return lines.length ? lines.map((l) => JSON.stringify(l)).join('\n') + '\n' : '';
}

interface DedupEntry {
  windowStart: number;
  suppressed: number;
}

/**
 * Dedup numbers: the first event of a key carries count 1. Further reports of
 * the same key inside dedupMs are suppressed and only counted. The first report
 * after the window creates a new event with count = suppressed + 1
 * (3 reports in the window -> 1 event, then the next event has count 3).
 */
export class ErrorReporter {
  readonly sessionId: string = randomUUID();

  private readonly opts: ReporterOptions;
  private readonly now: () => number;
  private readonly dedupMs: number;
  private readonly cap: number;
  private readonly retryMs: number;
  private readonly sendTimeoutMs: number;

  private seq = 0;
  private seen = new Map<string, DedupEntry>();
  private chain: Promise<void> = Promise.resolve();
  private inReport = false;
  private flushPromise: Promise<void> | null = null;
  private flushAgain = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(opts: ReporterOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
    this.dedupMs = opts.dedupMs ?? 10 * 60_000;
    this.cap = Math.max(1, opts.cap ?? 200);
    this.retryMs = opts.retryMs ?? 15 * 60_000;
    this.sendTimeoutMs = opts.sendTimeoutMs ?? 10_000;
  }

  report(err: AppError | unknown, where?: string): void {
    if (this.inReport) return; // re-entrant call: ignored
    this.inReport = true;
    try {
      this.reportInner(err, where);
    } catch (e) {
      warn(e);
    } finally {
      this.inReport = false;
    }
  }

  private reportInner(err: unknown, whereArg?: string): void {
    let where: string;
    let message: string;
    let piece: string | null = null;
    let stack: string | null = null;

    if (err instanceof Error) {
      where = whereArg ?? 'unknown';
      message = safeString(err.message);
      stack = typeof err.stack === 'string' ? err.stack : null;
    } else if (isAppError(err)) {
      where = err.where;
      message = err.message;
      piece = typeof err.piece === 'string' ? err.piece : null;
      stack = typeof err.stack === 'string' ? err.stack : null;
    } else {
      where = whereArg ?? 'unknown';
      message = safeString(err);
    }

    const cleanWhere = scrub(where);
    const cleanMessage = scrub(message);
    const key = cleanWhere + '\u0000' + cleanMessage;
    const t = this.now();

    const entry = this.seen.get(key);
    if (entry && t - entry.windowStart < this.dedupMs) {
      entry.suppressed++;
      return;
    }
    const count = (entry?.suppressed ?? 0) + 1;
    this.seen.set(key, { windowStart: t, suppressed: 0 });
    this.pruneSeen(t);

    const event: ErrorEvent = {
      timestamp: new Date(t).toISOString(),
      tag: 'MidiTutorError',
      level: 'E',
      message: scrub(`${where}: ${message}`),
      seq: ++this.seq,
      extras: {
        where: cleanWhere,
        piece: piece !== null ? scrub(piece) : null,
        stack: stack ? scrubStack(stack) : null,
        version: this.opts.version,
        machine: this.opts.machine,
        count,
      },
    };

    const line: OutboxLine = { ...event, session_id: this.sessionId };
    void this.run(() => this.append(line), undefined);

    try {
      this.opts.log?.(event);
    } catch (e) {
      warn(e);
    }

    this.scheduleFlush();
  }

  private pruneSeen(t: number): void {
    if (this.seen.size <= MAX_DEDUP_ENTRIES) return;
    for (const [k, v] of this.seen) {
      if (v.suppressed === 0 && t - v.windowStart >= this.dedupMs) this.seen.delete(k);
    }
    while (this.seen.size > MAX_DEDUP_ENTRIES) {
      const first = this.seen.keys().next();
      if (first.done) break;
      this.seen.delete(first.value);
    }
  }

  private scheduleFlush(): void {
    if (this.stopped) return;
    try {
      queueMicrotask(() => {
        void this.flush();
      });
    } catch (e) {
      warn(e);
    }
  }

  // Serialises all fs work on one chain; errors are swallowed and replaced by `fallback`.
  private run<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    const p: Promise<T> = this.chain.then(fn).catch((e) => {
      warn(e);
      return fallback;
    });
    this.chain = p.then(
      () => undefined,
      () => undefined,
    );
    return p;
  }

  private async readAll(): Promise<OutboxLine[]> {
    let raw: string;
    try {
      raw = await readFile(this.opts.outboxPath, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
      throw e;
    }
    return parseLines(raw);
  }

  private async append(line: OutboxLine): Promise<void> {
    await mkdir(dirname(this.opts.outboxPath), { recursive: true });
    const lines = await this.readAll();
    lines.push(line);
    await writeFile(this.opts.outboxPath, serialize(lines.slice(-this.cap)), 'utf8');
  }

  flush(): Promise<void> {
    if (this.flushPromise) {
      this.flushAgain = true;
      return this.flushPromise;
    }
    const p: Promise<void> = this.flushLoop()
      .catch((e) => warn(e))
      .then(() => {
        this.flushPromise = null;
      });
    this.flushPromise = p;
    return p;
  }

  private async flushLoop(): Promise<void> {
    do {
      this.flushAgain = false;
      await this.flushOnce();
    } while (this.flushAgain && !this.stopped);
  }

  private async flushOnce(): Promise<void> {
    const lines = await this.run(() => this.readAll(), [] as OutboxLine[]);
    if (lines.length === 0) return;

    const session = lines[0].session_id;
    const batch = lines.filter((l) => l.session_id === session).slice(0, MAX_BATCH);
    const events: ErrorEvent[] = batch.map((l) => {
      const { session_id: _ignored, ...rest } = l;
      void _ignored;
      return rest;
    });

    let ok = false;
    try {
      const res = await this.sendWithTimeout(events, session);
      ok = !!res && res.ok === true;
    } catch (e) {
      warn(e);
    }

    if (!ok) {
      this.armRetry();
      return;
    }

    const sent = new Set(batch.map((l) => `${l.session_id}\u0000${l.seq}`));
    const remaining = await this.run(async () => {
      const current = await this.readAll();
      const keep = current.filter((l) => !sent.has(`${l.session_id}\u0000${l.seq}`));
      await writeFile(this.opts.outboxPath, serialize(keep), 'utf8');
      return keep.length;
    }, -1);

    // More queued (another batch or another session): go again now. A failed rewrite waits for the retry.
    if (remaining > 0) this.flushAgain = true;
    else if (remaining < 0) this.armRetry();
  }

  private sendWithTimeout(
    events: ErrorEvent[],
    session: string,
  ): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        reject(new Error(`send timed out after ${this.sendTimeoutMs}ms`));
      }, this.sendTimeoutMs);
      if (typeof timer.unref === 'function') timer.unref();

      let p: Promise<{ ok: boolean; error?: string }>;
      try {
        p = Promise.resolve(this.opts.send(events, session));
      } catch (e) {
        done = true;
        clearTimeout(timer);
        reject(e);
        return;
      }
      p.then(
        (v) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          reject(e);
        },
      );
    });
  }

  private armRetry(): void {
    if (this.stopped || this.timer) return;
    try {
      const t = setTimeout(() => {
        this.timer = null;
        void this.flush();
      }, this.retryMs);
      if (typeof t.unref === 'function') t.unref();
      this.timer = t;
    } catch (e) {
      warn(e);
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
