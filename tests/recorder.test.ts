import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Writable, PassThrough } from 'node:stream';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Recorder, outputSize, takeFileName } from '../src/main/recorder';
import type { RecorderDeps, FrameSource, TakeEvent } from '../src/main/recorder';
import { sampleNote, voicesFromEvents, nearestSample, velocityGain, leadIn } from '../src/renderer/audio/OfflinePiano';

const size = { width: 4, height: 2 };
const frameMs = 1000 / 30;
const audioFormat = { sampleRate: 44100, channels: 2 };
const on = (t: number, velocity = 90): TakeEvent => ({ kind: 'noteon', note: 60, velocity, t });
const off = (t: number): TakeEvent => ({ kind: 'noteoff', note: 60, velocity: 0, t });
const pedal = (t: number, down: boolean): TakeEvent => ({ kind: 'pedal', down, t });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class FakeChild extends EventEmitter {
  chunks: Buffer[] = [];
  blocked = false;
  closed = false;
  stderr = new PassThrough();
  stdin = new Writable({
    write: (chunk: Buffer, _encoding, done) => { this.chunks.push(chunk); done(); },
  });

  constructor(readonly args: string[]) {
    super();
    const write = this.stdin.write.bind(this.stdin);
    this.stdin.write = ((chunk: Buffer) => {
      write(chunk);
      return !this.blocked;
    }) as typeof this.stdin.write;
    const complete = () => process.nextTick(() => {
      if (this.closed) return;
      fs.writeFileSync(args[args.length - 1], args.includes('-map') ? 'mux' : 'video');
      this.close(0);
    });
    if (args.includes('-map')) complete();
    else this.stdin.once('finish', complete);
  }

  close(code: number) {
    if (this.closed) return;
    this.closed = true;
    this.emit('close', code);
  }
  drain() { this.blocked = false; this.stdin.emit('drain'); }
  kill() { this.close(1); }
}

function harness() {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recorder-'));
  const children: FakeChild[] = [];
  const events: Record<string, unknown>[] = [];
  const takes: Parameters<RecorderDeps['renderAudio']>[0][] = [];
  const audio = deferred<typeof audioFormat>();
  const rendered = deferred<void>();
  let t = 1000;
  let pump = () => {};
  let receive: Parameters<FrameSource['subscribe']>[0] | undefined;
  const recorder = new Recorder({
    ffmpegPath: 'fake-ffmpeg', outDir,
    now: () => t,
    setInterval: ((callback: () => void) => {
      pump = callback;
      return 1;
    }) as unknown as NonNullable<RecorderDeps['setInterval']>,
    clearInterval: () => {},
    frames: () => ({
      subscribe: (callback) => { receive = callback; },
      unsubscribe: () => { receive = undefined; },
    }),
    spawn: ((_command: string, args: string[]) => {
      const child = new FakeChild(args);
      children.push(child);
      return child;
    }) as unknown as NonNullable<RecorderDeps['spawn']>,
    renderAudio: (take) => {
      takes.push(take);
      rendered.resolve();
      return audio.promise;
    },
    onEvent: (event) => { events.push(event); },
  }, { fps: 30 });
  return {
    recorder, outDir, children, events, takes, audio, rendered,
    start: () => recorder.start(size),
    at: (value: number) => { t = value; },
    pump: () => pump(),
    push: (n: number) => {
      const frame = { calls: 0 };
      if (!receive) throw new Error('No frame subscription');
      receive(() => { frame.calls++; return Buffer.alloc(size.width * size.height * 4, n); });
      return frame;
    },
    finish: () => { audio.resolve(audioFormat); return recorder.stop(); },
  };
}

describe('Recorder (#9574)', () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => { h = harness(); });
  afterEach(async () => {
    h.audio.resolve(audioFormat);
    h.children.forEach((child) => child.drain());
    if (h.recorder.status().state === 'recording') await h.recorder.stop().catch(() => {});
    fs.rmSync(h.outDir, { recursive: true, force: true });
  });

  it('sizes frames evenly and names take files', () => {
    expect(outputSize(1200, 800)).toEqual({ width: 1200, height: 800 });
    expect(outputSize(2560, 1440)).toEqual({ width: 1280, height: 720 });
    expect(outputSize(1201, 801)).toEqual({ width: 1200, height: 800 });
    expect(takeFileName(1000)).toMatch(/^take-\d{8}-\d{6}\.mp4$/);
  });

  it('duplicates frames by clock slots and caches each conversion', async () => {
    h.start();
    const a = h.push(1);
    // A slot is written once its centre (T0 + N*frameMs + half a frame) has passed.
    h.at(1100); h.pump();
    const chunks = h.children[0].chunks;
    expect(chunks).toHaveLength(3);
    expect(chunks.every((chunk) => chunk === chunks[0])).toBe(true);
    expect(chunks[0]).toEqual(Buffer.alloc(32, 1));
    const b = h.push(2);
    h.at(1200); h.pump();
    expect(chunks).toHaveLength(6);
    expect(chunks.slice(3).every((chunk) => chunk === chunks[3])).toBe(true);
    expect(chunks[3]).toEqual(Buffer.alloc(32, 2));
    expect([a.calls, b.calls]).toEqual([1, 1]);
    await h.finish();
  });

  it('a late pump never puts a newer frame into an earlier slot', async () => {
    h.start();
    h.push(1);            // painted at t=1000
    h.at(1050); h.push(2);  // painted at t=1050
    h.at(1100); h.pump();   // one late pump fills slots 0..2 (centres 1017, 1050, 1083)
    const fills = h.children[0].chunks.map((chunk) => chunk[0]);
    expect(fills).toEqual([1, 2, 2]);
    await h.finish();
  });

  it('writes a black frame before any frame arrives', async () => {
    h.start(); h.pump();
    expect(h.children[0].chunks).toEqual([Buffer.alloc(size.width * size.height * 4)]);
    await h.finish();
  });

  it('catches up to the original timeline after backpressure', async () => {
    h.start();
    const child = h.children[0];
    child.blocked = true;
    h.at(1333); h.pump();
    expect(child.chunks).toHaveLength(1);
    h.at(2000); h.pump();
    expect(child.chunks).toHaveLength(1);
    child.drain();
    // By t=2000 the centres of slots 0..29 have passed.
    expect(child.chunks).toHaveLength(30);
    await h.finish();
  });

  it('records relative event timestamps and drops events before T0', async () => {
    const note = { kind: 'noteon' as const, note: 60, velocity: 90 };
    h.recorder.noteEvent({ ...note, timestamp: 1100 });
    h.recorder.pedalEvent({ down: true, timestamp: 1100 });
    h.start();
    h.recorder.noteEvent({ ...note, timestamp: 999 });
    h.recorder.pedalEvent({ down: true, timestamp: 999 });
    h.recorder.noteEvent({ ...note, timestamp: 1000 });
    h.recorder.noteEvent({ ...note, kind: 'noteoff', velocity: 0, timestamp: 1100 });
    h.recorder.pedalEvent({ down: true, timestamp: 1050 });
    await h.finish();
    // The pedal was already down at Start, so the take opens sustained.
    expect(h.takes[0].events).toEqual([pedal(0, true), on(0), off(100), pedal(50, true)]);
  });

  it('opens a take with the pedal up when it was released before Start', async () => {
    h.recorder.pedalEvent({ down: true, timestamp: 900 });
    h.recorder.pedalEvent({ down: false, timestamp: 950 });
    h.start();
    await h.finish();
    expect(h.takes[0].events).toEqual([]);
  });

  it('ends the take when the encoder dies before Stop', async () => {
    h.start();
    h.children[0].close(1);
    await new Promise((resolve) => setImmediate(resolve));
    expect(h.recorder.status()).toMatchObject({ state: 'idle', finishing: 0 });
    expect(h.recorder.status().lastError).toMatch(/ffmpeg exited with 1/);
    expect(h.events.at(-1)).toMatchObject({ kind: 'recording', state: 'failed' });
    expect(() => h.start()).not.toThrow();
  });

  it('keeps the oldest frame for owed slots when the backlog is trimmed', async () => {
    h.start();
    const child = h.children[0];
    child.blocked = true;
    h.pump();                       // slot 0 written, then the pipe blocks
    for (let i = 1; i <= 20; i++) { h.at(1000 + i * 10); h.push(i); }
    h.at(1300);
    child.drain();
    // Nothing owed is black: each slot gets the frame painted by its centre or,
    // once that one has been trimmed, the oldest kept.
    expect(child.chunks.slice(1).every((chunk) => chunk[0] !== 0)).toBe(true);
    await h.finish();
  });

  it('becomes idle immediately, renders audio, muxes and cleans up', async () => {
    h.start(); h.at(1100); h.pump();
    const stopped = h.recorder.stop();
    expect(h.recorder.status()).toMatchObject({ state: 'idle', finishing: 1 });
    await h.rendered.promise;
    const take = h.takes[0];
    expect(take).toEqual({
      id: expect.stringMatching(/^take-\d{8}-\d{6}$/), events: [],
      durationMs: h.children[0].chunks.length * frameMs,
      pcmPath: path.join(h.outDir, `.tmp-${take.id}`, 'audio.pcm'),
    });
    h.audio.resolve(audioFormat);
    const output = path.join(h.outDir, `${take.id}.mp4`);
    await expect(stopped).resolves.toBe(output);
    const args = h.children[1].args;
    for (const [flag, value] of [['-c:v', 'copy'], ['-ar', '44100'], ['-ac', '2']]) {
      expect(args[args.indexOf(flag) + 1]).toBe(value);
    }
    expect(args[args.indexOf('-t') + 1]).toBe((take.durationMs / 1000).toFixed(3));
    expect(args[args.indexOf('-t') + 1]).toMatch(/^\d+\.\d{3}$/);
    expect(fs.readFileSync(output, 'utf8')).toBe('mux');
    expect(h.recorder.status()).toMatchObject({ finishing: 0, lastPath: output });
    expect(fs.existsSync(path.dirname(take.pcmPath))).toBe(false);
    expect(h.events).toContainEqual(expect.objectContaining({ state: 'saved', audio: true }));
  });

  it('saves video alone when rendering audio rejects', async () => {
    h.start();
    const stopped = h.recorder.stop();
    await h.rendered.promise;
    h.audio.reject(new Error('render failed'));
    const output = await stopped;
    expect(output).toBe(path.join(h.outDir, `${h.takes[0].id}.mp4`));
    expect(fs.readFileSync(output, 'utf8')).toBe('video');
    expect(h.children).toHaveLength(1);
    expect(h.recorder.status()).toMatchObject({
      lastPath: output, lastError: expect.stringMatching(/^audio:/), finishing: 0,
    });
    expect(h.events).toContainEqual(expect.objectContaining({ state: 'saved', audio: false }));
  });

  it('rejects overlapping recordings but allows a start while finishing', async () => {
    h.start();
    expect(() => h.start()).toThrow('already recording');
    const first = h.recorder.stop();
    await h.rendered.promise;
    expect(h.start()).toMatchObject({ state: 'recording', finishing: 1 });
    const second = h.recorder.stop();
    h.audio.resolve(audioFormat);
    const outputs = await Promise.all([first, second]);
    expect(new Set(outputs).size).toBe(2);
    expect(h.recorder.status()).toMatchObject({ state: 'idle', finishing: 0 });
  });

  it('reports an encode failure and rejects stop', async () => {
    h.start();
    h.children[0].close(1);
    await expect(h.recorder.stop()).rejects.toThrow('ffmpeg exited with 1');
    expect(h.recorder.status()).toMatchObject({ lastError: 'ffmpeg exited with 1', finishing: 0 });
    expect(h.events).toContainEqual(expect.objectContaining({ state: 'failed' }));
    expect(h.takes).toHaveLength(0);
  });
});

describe('OfflinePiano pure functions (#9574)', () => {
  it('parses sample names and paths', () => {
    for (const [name, note] of [
      ['A0.mp3', 21], ['C4.mp3', 60], ['Ds1.mp3', 27],
      ['Fs4', 66], ['../assets/salamander/C8.mp3', 108], ['X1.mp3', null],
    ] as const) expect(sampleNote(name)).toBe(note);
  });

  it('chooses the nearest sample, transposes it and breaks ties downward', () => {
    expect(nearestSample(61, [57, 60, 63])).toEqual({ sample: 60, rate: 2 ** (1 / 12) });
    expect(nearestSample(62, [60, 63]).sample).toBe(63);
    expect(nearestSample(63, [66, 60]).sample).toBe(60);
  });

  it('maps velocity monotonically from zero to 0.9', () => {
    expect(velocityGain(0)).toBe(0);
    expect(velocityGain(127)).toBe(0.9);
    for (let v = 1; v <= 127; v++) expect(velocityGain(v)).toBeGreaterThan(velocityGain(v - 1));
  });

  it('converts milliseconds to seconds and treats zero velocity as note-off', () => {
    for (const release of [off(1250), on(1250, 0)]) {
      expect(voicesFromEvents([on(250), release], 3)).toEqual([
        { note: 60, velocity: 90, start: 0.25, end: 1.25 },
      ]);
    }
  });

  it('sustains a released note until pedal-up', () => {
    expect(voicesFromEvents([on(0), pedal(100, true), off(1000), pedal(2000, false)], 3))
      .toEqual([{ note: 60, velocity: 90, start: 0, end: 2 }]);
  });

  it('ends a sustained voice when the same note is struck again', () => {
    expect(voicesFromEvents([on(0), pedal(100, true), off(1000), on(1500)], 3)).toEqual([
      { note: 60, velocity: 90, start: 0, end: 1.5 },
      { note: 60, velocity: 90, start: 1.5, end: 3 },
    ]);
  });

  it('sorts events, caps sounding voices and drops events at or beyond the end', () => {
    expect(voicesFromEvents([on(3000), on(2000), on(500)], 2))
      .toEqual([{ note: 60, velocity: 90, start: 0.5, end: 2 }]);
    expect(voicesFromEvents([off(1000), on(250)], 2))
      .toEqual([{ note: 60, velocity: 90, start: 0.25, end: 1 }]);
  });

  it('finds the audible lead-in and handles silence', () => {
    expect(leadIn(new Float32Array([0, 0, 0.001, 0.5, 0.2]), 1000)).toBe(0.003);
    expect(leadIn(new Float32Array(5), 1000)).toBe(0);
  });
});
