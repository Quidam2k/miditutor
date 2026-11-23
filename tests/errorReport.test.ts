import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  ErrorReporter,
  scrub,
  type ErrorEvent,
  type ReporterOptions,
} from '../src/main/errorReport';

type SendResult = { ok: boolean; error?: string };

const settle = () => new Promise<void>((r) => setTimeout(r, 20));

let tmp: string;
let outbox: string;
let reporters: ErrorReporter[] = [];
let nowValue: number;

function okSend() {
  return vi.fn(async (_events: ErrorEvent[], _sid: string): Promise<SendResult> => ({ ok: true }));
}

function make(over: Partial<ReporterOptions> = {}): ErrorReporter {
  const r = new ErrorReporter({
    outboxPath: outbox,
    send: okSend(),
    version: '1.2.3',
    machine: 'test-machine',
    now: () => nowValue,
    dedupMs: 1000,
    sendTimeoutMs: 50,
    retryMs: 1_000_000_000,
    ...over,
  });
  reporters.push(r);
  return r;
}

async function readOutbox(): Promise<string> {
  try {
    return await fs.readFile(outbox, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw e;
  }
}

async function outboxLines(): Promise<any[]> {
  const raw = await readOutbox();
  return raw
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'errrep-'));
  outbox = path.join(tmp, 'outbox.jsonl');
  nowValue = 1_700_000_000_000;
  reporters = [];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  for (const r of reporters) r.stop();
  vi.restoreAllMocks();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('ErrorReporter', () => {
  it('reports then flushes one event and empties the outbox', async () => {
    const send = okSend();
    const r = make({ send });
    r.report({ where: 'ipc x', message: 'boom' });
    await r.flush();
    await settle();

    expect(send).toHaveBeenCalledTimes(1);
    const [events] = send.mock.calls[0];
    expect(events).toHaveLength(1);
    expect(events[0].tag).toBe('MidiTutorError');
    expect(events[0].level).toBe('E');
    expect(events[0].seq).toBe(1);
    expect(events[0].extras.count).toBe(1);
    expect(events[0].message).toBe('ipc x: boom');
    expect((await readOutbox()).trim()).toBe('');
  });

  it('keeps the event when send returns ok:false and sends it on a later flush', async () => {
    const send = vi.fn(async (_e: ErrorEvent[], _s: string): Promise<SendResult> => ({
      ok: false,
      error: 'down',
    }));
    const r = make({ send });
    r.report({ where: 'w', message: 'm' });
    await r.flush();
    await settle();
    expect(await outboxLines()).toHaveLength(1);

    send.mockClear();
    send.mockImplementation(async () => ({ ok: true }));
    await r.flush();
    await settle();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toHaveLength(1);
    expect((await readOutbox()).trim()).toBe('');
  });

  it('survives a rejecting send and keeps the event', async () => {
    const send = vi.fn(async (_e: ErrorEvent[], _s: string): Promise<SendResult> => {
      throw new Error('network');
    });
    const r = make({ send });
    r.report({ where: 'w', message: 'm' });
    await expect(r.flush()).resolves.toBeUndefined();
    await settle();
    expect(await outboxLines()).toHaveLength(1);
  });

  it('survives a send that never resolves (timeout) and keeps the event', async () => {
    const send = vi.fn(
      (_e: ErrorEvent[], _s: string): Promise<SendResult> => new Promise<SendResult>(() => {}),
    );
    const r = make({ send });
    r.report({ where: 'w', message: 'm' });
    await expect(r.flush()).resolves.toBeUndefined();
    await settle();
    expect(send).toHaveBeenCalled();
    expect(await outboxLines()).toHaveLength(1);
  });

  it('dedups identical reports and carries the suppressed count on the next event', async () => {
    const send = okSend();
    const r = make({ send, dedupMs: 1000 });
    r.report({ where: 'w', message: 'same' });
    r.report({ where: 'w', message: 'same' });
    r.report({ where: 'w', message: 'same' });
    await r.flush();
    await settle();

    const sent1 = send.mock.calls.flatMap((c) => c[0]);
    expect(sent1).toHaveLength(1);
    expect(sent1[0].extras.count).toBe(1);

    nowValue += 1001;
    r.report({ where: 'w', message: 'same' });
    await r.flush();
    await settle();

    const all = send.mock.calls.flatMap((c) => c[0]);
    expect(all).toHaveLength(2);
    expect(all[1].extras.count).toBe(3);
  });

  it('caps the outbox keeping the newest events', async () => {
    const send = vi.fn(async (_e: ErrorEvent[], _s: string): Promise<SendResult> => ({
      ok: false,
    }));
    const r = make({ send, cap: 5 });
    for (let i = 1; i <= 8; i++) r.report({ where: 'w', message: `m${i}` });
    await r.flush();
    await settle();

    const lines = await outboxLines();
    expect(lines).toHaveLength(5);
    expect(lines.map((l) => l.message)).toEqual(['w: m4', 'w: m5', 'w: m6', 'w: m7', 'w: m8']);
  });

  it('scrub removes sensitive content and truncates', () => {
    const xml = scrub('<note><pitch>C</pitch></note>');
    expect(xml).toContain('<xml>');
    expect(xml).not.toContain('pitch');
    expect(scrub('Bearer abc.def')).toBe('Bearer ***');
    expect(scrub('/Users/toddwalker/x').startsWith('~/')).toBe(true);
    expect(scrub('C:\\Users\\Todd\\x').startsWith('~/')).toBe(true);
    expect(scrub('a'.repeat(600))).toHaveLength(500);
  });

  it('still queues the event when log throws', async () => {
    const send = okSend();
    const r = make({
      send,
      log: () => {
        throw new Error('log broke');
      },
    });
    expect(() => r.report({ where: 'w', message: 'm' })).not.toThrow();
    await r.flush();
    await settle();
    expect(send.mock.calls.flatMap((c) => c[0])).toHaveLength(1);
  });

  it('ignores re-entrant report calls from log', async () => {
    const send = okSend();
    let r: ErrorReporter;
    let logCalls = 0;
    r = make({
      send,
      log: () => {
        logCalls++;
        r.report({ where: 'inner', message: 'again' });
      },
    });
    r.report({ where: 'w', message: 'm' });
    await r.flush();
    await settle();
    expect(logCalls).toBe(1);
    expect(send.mock.calls.flatMap((c) => c[0])).toHaveLength(1);
  });

  it('never throws when the outbox path is a directory', async () => {
    const send = okSend();
    const r = make({ send, outboxPath: tmp });
    expect(() => r.report({ where: 'w', message: 'm' })).not.toThrow();
    await expect(r.flush()).resolves.toBeUndefined();
    await settle();
  });

  it('sends older-session lines first, then the current session', async () => {
    const old = {
      timestamp: new Date(nowValue - 5000).toISOString(),
      tag: 'MidiTutorError',
      level: 'E',
      message: 'old: thing',
      seq: 1,
      extras: {
        where: 'old',
        piece: null,
        stack: null,
        version: '0.0.1',
        machine: 'm',
        count: 1,
      },
      session_id: 'old',
    };
    await fs.writeFile(outbox, JSON.stringify(old) + '\n', 'utf8');

    const send = okSend();
    const r = make({ send });
    r.report({ where: 'w', message: 'new' });
    await r.flush();
    await settle();

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][1]).toBe('old');
    expect(send.mock.calls[1][1]).toBe(r.sessionId);
    expect((await readOutbox()).trim()).toBe('');
  });

  it('does not recurse or throw when send and log both throw', async () => {
    const send = vi.fn((_e: ErrorEvent[], _s: string): Promise<SendResult> => {
      throw new Error('sync send failure');
    });
    const r = make({
      send,
      log: () => {
        throw new Error('log failure');
      },
    });
    expect(() => r.report({ where: 'w', message: 'm' })).not.toThrow();
    await expect(r.flush()).resolves.toBeUndefined();
    await settle();
    expect(send.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('formats Error objects with where and a stack', async () => {
    const send = okSend();
    const r = make({ send });
    const err = new Error('boom');
    r.report(err, 'where-x');
    await r.flush();
    await settle();

    const events = send.mock.calls.flatMap((c) => c[0]);
    expect(events).toHaveLength(1);
    expect(events[0].message).toBe(`where-x: ${err.message}`);
    expect(events[0].extras.stack).not.toBeNull();
  });
});
