import * as http from 'node:http';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { GestureTracker, checkChord, type Gesture } from '../shared/music';

export type TaskResult = {
  verdict: 'correct' | 'wrong' | 'incomplete';
  missing: string[];
  extra: string[];
  played: number[];
  names: string[];
  gestureId: number;
  at: number;
};

export type Task = {
  id: number;
  kind: 'chord';
  label: string;
  notes: string[];
  createdAt: number;
  /** Latest graded attempt (once 'correct', grading stops). */
  result: TaskResult | null;
  /** Every graded attempt, oldest first, so a persona can tell first-try from shaky. */
  attempts: TaskResult[];
};

export type RendererCommand =
  | { type: 'task'; task: Task }
  | { type: 'clear-task' }
  | { type: 'piece'; title: string; musicxml: string; photo?: string }
  | { type: 'inject'; kind: 'noteon' | 'noteoff'; note: number; velocity: number };

type NoteEvent = {
  kind: 'noteon' | 'noteoff';
  note: number;
  velocity: number;
  source: string;
  timestamp: number;
};

type Waiter = {
  after: number;
  res: http.ServerResponse;
  timer: ReturnType<typeof setTimeout>;
};

class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export function loadOrCreateToken(dir: string): string {
  const file = path.join(dir, 'api-token');
  try {
    const token = fs.readFileSync(file, 'utf8').trim();
    if (token) return token;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  fs.mkdirSync(dir, { recursive: true });
  const token = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, token, { mode: 0o600 });
  return token;
}

export class TutorApi {
  private readonly tracker = new GestureTracker();
  private readonly now: () => number;
  private server: http.Server | null = null;
  private starting: Promise<number> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly waiters = new Set<Waiter>();
  private readonly events: (NoteEvent & { seq: number })[] = [];
  private readonly gestures: Gesture[] = [];
  private eventSeq = 0;
  private lastGestureId = 0;
  private taskId = 0;
  private task: Task | null = null;
  private screen: Record<string, unknown> = {};
  private device: { connected: boolean; name: string | null } = { connected: false, name: null };
  // The window reports its device on mount, so this flips once it can hear notes.
  private rendererConnected = false;

  constructor(private readonly opts: {
    port: number;
    host?: string;
    token: string;
    allowInject: boolean;
    sendToRenderer: (cmd: RendererCommand) => void;
    now?: () => number;
  }) {
    this.now = opts.now ?? Date.now;
  }

  start(): Promise<number> {
    if (this.starting) return this.starting;
    const address = this.server?.address();
    if (address && typeof address === 'object') return Promise.resolve(address.port);
    const server = http.createServer((req, res) => {
      void this.handle(req, res).catch((error: unknown) => {
        this.reply(res, error instanceof HttpError ? error.status : 500, {
          error: error instanceof HttpError ? error.message : 'Internal server error',
        });
      });
    });
    this.server = server;
    // Keep server errors from becoming uncaught process errors.
    server.on('error', (err) => console.error('[tutor-api]', err.message));
    const pending = new Promise<number>((resolve, reject) => {
      const failed = (error: Error) => {
        if (this.server === server) this.server = null;
        reject(error);
      };
      server.once('error', failed);
      server.listen(this.opts.port, this.opts.host ?? '127.0.0.1', () => {
        server.removeListener('error', failed);
        const bound = server.address();
        if (!bound || typeof bound === 'string') return reject(new Error('No bound port'));
        this.interval = setInterval(() => {
          try {
            const gesture = this.tracker.tick(this.now());
            if (gesture) this.completeGesture(gesture);
          } catch {
            // Tracker or renderer failures must not escape the timer callback.
          }
        }, 25);
        this.interval.unref();
        resolve(bound.port);
      });
    });
    this.starting = pending.finally(() => { this.starting = null; });
    return this.starting;
  }

  async stop(): Promise<void> {
    if (this.starting) await this.starting.catch(() => undefined);
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    for (const waiter of this.waiters) this.finishWaiter(waiter, true);
    const server = this.server;
    this.server = null;
    if (server) await new Promise<void>((resolve) => { server.close(() => resolve()); });
  }

  onNote(ev: NoteEvent): void {
    this.events.push({ ...ev, seq: ++this.eventSeq });
    if (this.events.length > 2000) this.events.shift();
    if (ev.kind === 'noteon') this.tracker.noteOn(ev.note, this.now());
    else this.tracker.noteOff(ev.note, this.now());
  }

  onRendererState(s: Record<string, unknown>): void {
    this.screen = { ...this.screen, ...s };
  }

  onDevice(d: { connected: boolean; name: string | null }): void {
    this.device = { ...d };
    this.rendererConnected = true;
  }

  private completeGesture(gesture: Gesture): void {
    this.gestures.push(gesture);
    if (this.gestures.length > 500) this.gestures.shift();
    this.lastGestureId = gesture.id;
    try {
      const task = this.task;
      if (task && task.result?.verdict !== 'correct') {
        const result: TaskResult = {
          ...checkChord(task.notes, gesture.notes),
          played: [...gesture.notes],
          names: [...gesture.names],
          gestureId: gesture.id,
          at: this.now(),
        };
        this.task = { ...task, result, attempts: [...task.attempts, result] };
        this.opts.sendToRenderer({ type: 'task', task: this.task });
      }
    } finally {
      for (const waiter of this.waiters) this.finishWaiter(waiter, false);
    }
  }

  private finishWaiter(waiter: Waiter, timedOut: boolean): void {
    const gesture = timedOut ? null : this.gestures.find((g) => g.id > waiter.after);
    if (!timedOut && !gesture) return;
    clearTimeout(waiter.timer);
    this.waiters.delete(waiter);
    this.reply(waiter.res, 200, { gesture: gesture ?? null, task: this.task, timedOut });
  }

  private reply(res: http.ServerResponse, status: number, value: unknown): void {
    if (res.destroyed || res.writableEnded) return;
    const body = JSON.stringify(value);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(body);
  }

  private number(url: URL, key: string, fallback: number, max = Infinity, min = 0): number {
    const raw = url.searchParams.get(key);
    if (raw === null) return fallback;
    const value = Number(raw);
    if (!raw.trim() || !Number.isSafeInteger(value) || value < min) {
      throw new HttpError(400, `Invalid ${key}`);
    }
    return Math.min(value, max);
  }

  private body(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let exceeded = false;
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 5 * 1024 * 1024) {
          if (!exceeded) reject(new HttpError(413, 'Body too large'));
          exceeded = true;
          chunks.length = 0;
        } else if (!exceeded) chunks.push(chunk);
      });
      req.on('error', reject);
      req.on('aborted', () => reject(new HttpError(400, 'Request aborted')));
      req.on('end', () => {
        if (exceeded) return;
        try {
          const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error('Expected an object');
          }
          resolve(value as Record<string, unknown>);
        } catch {
          reject(new HttpError(400, 'Bad JSON'));
        }
      });
    });
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const auth = req.headers.authorization ?? '';
    const supplied = Buffer.from(auth.startsWith('Bearer ') ? auth.slice(7) : '');
    const expected = Buffer.from(this.opts.token);
    if (!auth.startsWith('Bearer ') || supplied.length !== expected.length ||
        !crypto.timingSafeEqual(supplied, expected)) {
      throw new HttpError(401, 'Unauthorized');
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = `${req.method} ${url.pathname}`;
    const send = (value: unknown) => this.reply(res, 200, value);
    if (route === 'GET /state') {
      send({ ok: true, rendererConnected: this.rendererConnected, device: this.device,
        screen: this.screen, task: this.task,
        lastGestureId: this.lastGestureId, eventSeq: this.eventSeq,
        injectEnabled: this.opts.allowInject });
    } else if (route === 'GET /events' || route === 'GET /gestures') {
      const since = this.number(url, 'since', 0);
      const limit = this.number(url, 'limit', 200, 2000, 1);
      send(route === 'GET /events'
        ? { events: this.events.filter((e) => e.seq > since).slice(-limit), lastSeq: this.eventSeq }
        : { gestures: this.gestures.filter((g) => g.id > since).slice(-limit), lastId: this.lastGestureId });
    } else if (route === 'GET /gestures/next') {
      const after = this.number(url, 'after', this.lastGestureId);
      const timeout = this.number(url, 'timeoutMs', 30000, 120000);
      const gesture = this.gestures.find((g) => g.id > after);
      if (gesture) return send({ gesture, task: this.task, timedOut: false });
      const waiter: Waiter = { after, res,
        timer: setTimeout(() => this.finishWaiter(waiter, true), timeout) };
      waiter.timer.unref();
      this.waiters.add(waiter);
      res.once('close', () => {
        if (!res.writableFinished) {
          clearTimeout(waiter.timer);
          this.waiters.delete(waiter);
        }
      });
    } else if (route === 'GET /task') {
      send({ task: this.task, lastGestureId: this.lastGestureId });
    } else if (route === 'DELETE /task') {
      this.task = null;
      this.opts.sendToRenderer({ type: 'clear-task' });
      send({ ok: true });
    } else if (route === 'POST /task') {
      const { label, notes } = await this.body(req);
      if (typeof label !== 'string' || !label.trim() || !Array.isArray(notes) ||
          notes.length < 1 || notes.length > 8 || !notes.every((n) => typeof n === 'string')) {
        throw new HttpError(400, 'Expected a non-empty label and 1..8 note strings');
      }
      this.task = { id: ++this.taskId, kind: 'chord', label, notes: [...notes],
        createdAt: this.now(), result: null, attempts: [] };
      this.opts.sendToRenderer({ type: 'task', task: this.task });
      send({ task: this.task });
    } else if (route === 'POST /piece') {
      const { title, musicxml, photo } = await this.body(req);
      if (typeof title !== 'string' || typeof musicxml !== 'string' ||
          (!musicxml.includes('<score-partwise') && !musicxml.includes('<score-timewise')) ||
          (photo !== undefined && typeof photo !== 'string')) {
        throw new HttpError(400, 'Invalid piece');
      }
      this.opts.sendToRenderer({ type: 'piece', title, musicxml,
        ...(typeof photo === 'string' ? { photo } : {}) });
      send({ ok: true });
    } else if (route === 'POST /inject') {
      if (!this.opts.allowInject) throw new HttpError(404, 'Not found');
      const { notes, kind = 'chord', holdMs = 300, spreadMs = 10, velocity = 80 } = await this.body(req);
      if (!Array.isArray(notes) || !notes.length ||
          !notes.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 127) ||
          !['chord', 'noteon', 'noteoff'].includes(String(kind)) ||
          typeof velocity !== 'number' || !Number.isInteger(velocity) || velocity < 0 || velocity > 127 ||
          typeof holdMs !== 'number' || !Number.isFinite(holdMs) || holdMs < 0 ||
          typeof spreadMs !== 'number' || !Number.isFinite(spreadMs) || spreadMs < 0 ||
          holdMs + (notes.length - 1) * spreadMs > 2147483647) {
        throw new HttpError(400, 'Invalid injection');
      }
      notes.forEach((note: number, index: number) => {
        const emit = (eventKind: 'noteon' | 'noteoff', delay: number) => {
          const command: RendererCommand = { type: 'inject', kind: eventKind, note, velocity };
          if (delay === 0) return this.opts.sendToRenderer(command);
          const timer = setTimeout(() => {
            this.timers.delete(timer);
            try { this.opts.sendToRenderer(command); } catch { /* Keep timer failures contained. */ }
          }, delay);
          timer.unref();
          this.timers.add(timer);
        };
        if (kind === 'chord') {
          emit('noteon', index * spreadMs);
          emit('noteoff', index * spreadMs + holdMs);
        } else {
          emit(kind as 'noteon' | 'noteoff', 0);
        }
      });
      send({ ok: true, label: 'INJECTED - not a real MIDI device' });
    } else {
      throw new HttpError(404, 'Not found');
    }
  }
}
