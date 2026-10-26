// Take recorder (#9574): the window's own frames -> H.264 through a bundled
// ffmpeg, the MIDI played meanwhile, and after Stop the piano audio rendered
// from that MIDI, muxed into one mp4. Electron-free so it unit-tests with fakes.
// Sync contract: video slot N is what was on screen at T0 + N*frameMs (frames
// are duplicated to keep pace, never time-shifted) and every MIDI event sits at
// its timestamp - T0, so audio and picture share one clock.
import * as fs from 'node:fs';
import * as files from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';

export type TakeEvent =
  | { kind: 'noteon' | 'noteoff'; note: number; velocity: number; t: number }
  | { kind: 'pedal'; down: boolean; t: number };

export type RecordingState = 'idle' | 'recording';

export interface RecordingStatus {
  state: RecordingState;
  startedAt: number | null;
  elapsedMs: number;
  finishing: number;
  lastPath: string | null;
  lastError: string | null;
}

export interface FrameSource {
  subscribe(cb: (frame: () => Buffer) => void): void;
  unsubscribe(): void;
}

export interface RecorderDeps {
  ffmpegPath: string;
  outDir: string;
  frames: (size: { width: number; height: number }) => FrameSource;
  renderAudio: (take: {
    id: string; events: TakeEvent[]; durationMs: number; pcmPath: string;
  }) => Promise<{ sampleRate: number; channels: number }>;
  onStatus?: (s: RecordingStatus) => void;
  onEvent?: (ev: Record<string, unknown>) => void;
  now?: () => number;
  spawn?: typeof spawn;
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
}

type Take = {
  id: string;
  tmp: string;
  t0: number;
  events: TakeEvent[];
  stop: () => Promise<number>;
  // Main-thread cost of the capture, for tuning fps / frame format on the Mac.
  stats: { painted: number; converted: number; convertMs: number; convertMaxMs: number; pumpLateMaxMs: number };
};

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function outputSize(width: number, height: number, maxWidth = 1280): {
  width: number; height: number;
} {
  if (![width, height, maxWidth].every((n) => Number.isFinite(n) && n > 0)) {
    throw new Error('Invalid recording size');
  }
  const scale = Math.min(1, maxWidth / width);
  return {
    width: Math.max(2, Math.floor(width * scale / 2) * 2),
    height: Math.max(2, Math.floor(height * scale / 2) * 2),
  };
}

export function takeFileName(t0: number): string {
  const d = new Date(t0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `take-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.mp4`;
}

export class Recorder {
  private readonly now: () => number;
  private readonly frameMs: number;
  private active: Take | null = null;
  private finishing = 0;
  private lastPath: string | null = null;
  private lastError: string | null = null;
  // Tracked between takes too: a pedal held across Start must sustain from t=0.
  private pedalDown = false;

  constructor(private readonly deps: RecorderDeps, opts?: { fps?: number }) {
    const fps = opts?.fps ?? 30;
    if (!Number.isFinite(fps) || fps <= 0) throw new Error('Invalid recording fps');
    this.frameMs = 1000 / fps;
    this.now = deps.now ?? Date.now;
  }

  status(): RecordingStatus {
    return {
      state: this.active ? 'recording' : 'idle',
      startedAt: this.active?.t0 ?? null,
      elapsedMs: this.active ? Math.max(0, this.now() - this.active.t0) : 0,
      finishing: this.finishing,
      lastPath: this.lastPath,
      lastError: this.lastError,
    };
  }

  start(size: { width: number; height: number }): RecordingStatus {
    if (this.active) throw new Error('already recording');
    size = outputSize(size.width, size.height);
    const t0 = this.now();
    const base = takeFileName(t0).slice(0, -4);
    fs.mkdirSync(this.deps.outDir, { recursive: true });
    let id = base;
    let suffix = 2;
    while (fs.existsSync(path.join(this.deps.outDir, `${id}.mp4`)) ||
           fs.existsSync(path.join(this.deps.outDir, `.tmp-${id}`))) {
      id = `${base}-${suffix++}`;
    }
    const tmp = path.join(this.deps.outDir, `.tmp-${id}`);
    fs.mkdirSync(tmp);
    let child: ReturnType<typeof spawn> | undefined;
    let encoded: Promise<void> | undefined;
    let source: FrameSource | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    const clear = () => {
      if (timer !== undefined) (this.deps.clearInterval ?? clearInterval)(timer);
    };
    try {
      const job = this.ffmpeg([
        '-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', `${size.width}x${size.height}`,
        '-r', String(1000 / this.frameMs), '-i', 'pipe:0', '-c:v', 'libx264',
        '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart', path.join(tmp, 'video.mp4'),
      ], true);
      child = job.child;
      encoded = job.done;
      const input = child.stdin;
      if (!input) throw new Error('ffmpeg stdin unavailable');
      // Painted frames stamped on arrival. A late pump (busy main thread) must not
      // put a newer picture into an earlier slot, which would show a note before
      // it sounds, so each slot takes the newest frame that existed by its time.
      // A slot's time is its centre (T0 + N*frameMs + half a frame): a paint lands
      // in the nearest slot, not always the next one, which halves the error.
      const stats = { painted: 0, converted: 0, convertMs: 0, convertMaxMs: 0, pumpLateMaxMs: 0 };
      const recent: { at: number; get: () => Buffer; buf?: Buffer }[] = [];
      const black = Buffer.alloc(size.width * size.height * 4);
      const frameAt = (time: number): Buffer => {
        let i = recent.length - 1;
        while (i > 0 && recent[i].at > time) i--;
        if (i < 0 || recent[i].at > time) return black;
        recent.splice(0, i);   // older frames can never be picked again
        const entry = recent[0];
        if (!entry.buf) {
          const began = this.now();
          entry.buf = entry.get();
          const took = this.now() - began;
          stats.converted++;
          stats.convertMs += took;
          stats.convertMaxMs = Math.max(stats.convertMaxMs, took);
        }
        return entry.buf;
      };
      let written = 0;
      let target: number | null = null;
      let blocked = false;
      let ended = false;
      // Multiply by fps rather than divide by frameMs: 1000 / (1000/30) is 29.999...
      const fps = 1000 / this.frameMs;
      const half = 500 / fps;
      // Slots whose centre has passed, so every frame that belongs in them has arrived.
      const slots = () => Math.max(1, Math.floor((this.now() - t0 - half) * fps / 1000 + 1e-9) + 1);
      const pump = () => {
        if (ended) return;
        try {
          const due = target ?? slots();
          while (!blocked && written < due) {
            const centre = t0 + written * 1000 / fps + half;
            if (target === null) stats.pumpLateMaxMs = Math.max(stats.pumpLateMaxMs, this.now() - centre);
            blocked = !input.write(frameAt(centre));
            written++;
          }
          if (target !== null && written >= target) {
            ended = true;
            input.end();
          }
        } catch (error) {
          ended = true;
          job.abort(error);
        }
      };
      input.on('drain', () => { blocked = false; pump(); });
      // Observe early exits now, even if the user has not pressed Stop yet.
      // An encoder that dies before Stop ends the take now rather than leaving a
      // recording that only looks alive; after Stop, finish() reports it.
      void job.done.then(() => { ended = true; clear(); }, (error) => {
        ended = true;
        clear();
        if (this.active?.id !== id) return;   // Stop already took it: finish() reports
        this.active = null;
        try { source?.unsubscribe(); } catch { /* Report the encoder error. */ }
        this.lastError = message(error);
        fs.rm(tmp, { recursive: true, force: true }, () => undefined);
        this.deps.onEvent?.({ kind: 'recording', state: 'failed', id, error: this.lastError });
        this.deps.onStatus?.(this.status());
      });
      source = this.deps.frames(size);
      source.subscribe((frame) => {
        if (target !== null || ended) return;
        recent.push({ at: this.now(), get: frame });
        stats.painted++;
        // Bound memory if the encoder falls behind (a Retina frame is ~14 MB): 0.5 s.
        // Keep the oldest, so the slots still owed get a stale frame, not black.
        if (recent.length > fps / 2) recent.splice(1, 1);
      });
      timer = (this.deps.setInterval ?? setInterval)(pump, this.frameMs / 2);
      this.active = {
        id, tmp, t0, events: [], stats,
        stop: () => {
          target = slots();
          clear();
          try { source?.unsubscribe(); } catch (error) { job.abort(error); }
          pump();
          return job.done.then(() => written * this.frameMs);
        },
      };
    } catch (error) {
      clear();
      try { source?.unsubscribe(); } catch { /* Preserve the startup error. */ }
      child?.kill();
      // Windows keeps files open until ffmpeg has exited.
      void (encoded ?? Promise.resolve()).catch(() => undefined)
        .finally(() => fs.rm(tmp, { recursive: true, force: true }, () => undefined));
      this.lastError = message(error);
      throw error;
    }
    if (this.pedalDown) this.active.events.push({ kind: 'pedal', down: true, t: 0 });
    this.lastError = null;
    this.deps.onStatus?.(this.status());
    this.deps.onEvent?.({ kind: 'recording', state: 'started', id, startedAt: t0 });
    return this.status();
  }

  stop(): Promise<string> {
    const take = this.active;
    if (!take) return Promise.reject(new Error('not recording'));
    this.active = null;
    this.finishing++;
    const video = take.stop();
    this.deps.onStatus?.(this.status());
    return this.finish(take, video);
  }

  noteEvent(ev: { kind: 'noteon' | 'noteoff'; note: number; velocity: number; timestamp: number }): void {
    const take = this.active;
    if (!take || ev.timestamp < take.t0) return;
    take.events.push({ kind: ev.kind, note: ev.note, velocity: ev.velocity, t: ev.timestamp - take.t0 });
  }

  pedalEvent(ev: { down: boolean; timestamp: number }): void {
    this.pedalDown = ev.down;
    const take = this.active;
    if (!take || ev.timestamp < take.t0) return;
    take.events.push({ kind: 'pedal', down: ev.down, t: ev.timestamp - take.t0 });
  }

  // stdin is the frame pipe for the encode; the mux reads files only.
  private ffmpeg(args: string[], input = false) {
    const child = (this.deps.spawn ?? spawn)(this.deps.ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', ...(input ? [] : ['-nostdin']), ...args,
    ], { stdio: [input ? 'pipe' : 'ignore', 'ignore', 'pipe'], windowsHide: true });
    let tail = '';
    let aborted: unknown = null;
    const done = new Promise<void>((resolve, reject) => {
      const fail = (error: unknown) => reject(new Error(
        `${message(error)}${tail ? `: ${tail.trim()}` : ''}`,
      ));
      child.stderr?.on('data', (chunk: Buffer) => {
        tail = (tail + chunk.toString()).slice(-4096);
      });
      child.once('error', fail);   // never started: there is no process to wait for
      // A broken pipe settles only once ffmpeg has exited and let go of its files.
      child.stdin?.on('error', (error) => abort(error));
      child.once('close', (code, signal) => {
        if (code === 0 && !aborted) resolve();
        else fail(aborted ?? new Error(`ffmpeg exited with ${signal ?? code}`));
      });
    });
    const abort = (error: unknown) => {
      aborted ??= error;
      child.kill();
    };
    // Encoding can fail before stop() attaches its own await.
    void done.catch(() => undefined);
    return { child, done, abort };
  }

  private async finish(take: Take, video: Promise<number>): Promise<string> {
    const output = path.join(this.deps.outDir, `${take.id}.mp4`);
    const videoPath = path.join(take.tmp, 'video.mp4');
    const pcmPath = path.join(take.tmp, 'audio.pcm');
    try {
      const durationMs = await video;
      let audio: { sampleRate: number; channels: number } | undefined;
      let audioError: string | null = null;
      try {
        audio = await this.deps.renderAudio({ id: take.id, events: take.events, durationMs, pcmPath });
      } catch (error) {
        audioError = `audio: ${message(error)}`;
      }
      if (audio) {
        await this.ffmpeg([
          '-y', '-i', videoPath, '-f', 's16le', '-ar', String(audio.sampleRate),
          '-ac', String(audio.channels), '-i', pcmPath, '-map', '0:v', '-map', '1:a',
          '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
          '-t', (durationMs / 1000).toFixed(3), '-movflags', '+faststart', output,
        ]).done;
      } else {
        await files.copyFile(videoPath, output);
      }
      this.lastPath = output;
      this.lastError = audioError;
      this.deps.onEvent?.({
        kind: 'recording', state: 'saved', path: output, durationMs,
        notes: take.events.filter((ev) => ev.kind === 'noteon').length, audio: !!audio,
        capture: { ...take.stats, convertMs: Math.round(take.stats.convertMs) },
      });
      return output;
    } catch (error) {
      this.lastError = message(error);
      this.deps.onEvent?.({ kind: 'recording', state: 'failed', id: take.id, error: this.lastError });
      throw error;
    } finally {
      await files.rm(take.tmp, { recursive: true, force: true }).catch(() => undefined);
      this.finishing--;
      this.deps.onStatus?.(this.status());
    }
  }
}
