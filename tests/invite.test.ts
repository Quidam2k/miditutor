import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import * as https from 'node:https';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';
import type { AddressInfo, Socket } from 'node:net';
import { InviteTimer, postLive } from '../src/main/invite';

describe('InviteTimer', () => {
  const idleMs = 10 * 60_000;
  const startTime = Date.UTC(2026, 0, 1);
  const inactive = { active: false, since: null, endsAt: null };
  let timer: InviteTimer;
  let onIdle: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(startTime);
    onIdle = vi.fn();
    timer = new InviteTimer({ idleMs, onIdle });
  });

  afterEach(() => {
    timer.dispose();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('sets since and endsAt and leaves an active start unchanged', () => {
    const started = {
      active: true,
      since: startTime,
      endsAt: startTime + idleMs,
    };

    expect(timer.start()).toEqual(started);
    expect(timer.state()).toEqual(started);

    vi.advanceTimersByTime(60_000);
    expect(timer.start()).toEqual(started);
    expect(timer.state()).toEqual(started);

    vi.advanceTimersByTime(idleMs - 60_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(timer.state()).toEqual(inactive);
  });

  it('fires once exactly at the idle deadline and becomes inactive', () => {
    timer.start();

    vi.advanceTimersByTime(idleMs - 1);
    expect(onIdle).not.toHaveBeenCalled();
    expect(timer.state().active).toBe(true);

    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(timer.state()).toEqual(inactive);

    vi.advanceTimersByTime(idleMs);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('extends the deadline to 19 minutes after a note at 9 minutes', () => {
    timer.start();
    vi.advanceTimersByTime(9 * 60_000);
    timer.noteOn();

    expect(timer.lastNoteAt).toBe(startTime + 9 * 60_000);
    expect(timer.state()).toEqual({
      active: true,
      since: startTime,
      endsAt: startTime + 19 * 60_000,
    });

    vi.advanceTimersByTime(9 * 60_000 + 59_000);
    expect(timer.state().active).toBe(true);
    expect(onIdle).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(timer.state()).toEqual(inactive);

    vi.advanceTimersByTime(idleMs);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('records notes while inactive without starting or arming a timer', () => {
    expect(timer.lastNoteAt).toBeNull();

    vi.advanceTimersByTime(60_000);
    timer.noteOn();

    expect(timer.lastNoteAt).toBe(startTime + 60_000);
    expect(timer.state()).toEqual(inactive);
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(60 * 60_000);
    expect(onIdle).not.toHaveBeenCalled();
    expect(timer.state()).toEqual(inactive);
  });

  it('stops before expiry and allows repeated stops', () => {
    timer.start();
    vi.advanceTimersByTime(idleMs - 1);

    expect(timer.stop()).toEqual(inactive);
    expect(timer.stop()).toEqual(inactive);
    expect(timer.state()).toEqual(inactive);
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(60 * 60_000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('is already inactive when onIdle throws', () => {
    const failure = new Error('onIdle failed');
    onIdle.mockImplementation(() => {
      expect(timer.state()).toEqual(inactive);
      throw failure;
    });
    timer.start();

    try {
      vi.advanceTimersByTime(idleMs);
    } catch (error) {
      expect(error).toBe(failure);
    }

    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(timer.state()).toEqual(inactive);

    vi.advanceTimersByTime(idleMs);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('clears the pending timer on dispose', () => {
    timer.start();
    vi.advanceTimersByTime(idleMs - 1);
    timer.dispose();

    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60 * 60_000);
    expect(onIdle).not.toHaveBeenCalled();
  });
});

// Throwaway self-signed certs (CN=localhost) made per run: a private key never goes in the repo.
function makeCert(dir: string, name: string): { cert: string; key: string } | null {
  const keyFile = path.join(dir, `${name}-key.pem`);
  const certFile = path.join(dir, `${name}-cert.pem`);
  const made = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile,
    '-out', certFile, '-days', '2', '-subj', '/CN=localhost'], { stdio: 'ignore' });
  if (made.status !== 0) return null;
  return { cert: fs.readFileSync(certFile, 'utf8'), key: fs.readFileSync(keyFile, 'utf8') };
}

describe('postLive', () => {
  const certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'invite-cert-'));
  const pinned = makeCert(certDir, 'pantheon');
  const other = makeCert(certDir, 'other');
  const cert = pinned?.cert ?? '';
  const key = pinned?.key ?? '';
  const otherCert = other?.cert ?? '';
  const withCerts = pinned && other ? it : it.skip;

  let servers: Array<http.Server | https.Server>;
  let sockets: Set<Socket>;

  beforeEach(() => {
    vi.useRealTimers();
    servers = [];
    sockets = new Set();
  });

  async function listen(server: http.Server | https.Server): Promise<string> {
    servers.push(server);
    server.on('connection', (socket: Socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });

    const { port } = server.address() as AddressInfo;
    const protocol = server instanceof https.Server ? 'https' : 'http';
    return `${protocol}://127.0.0.1:${port}`;
  }

  async function close(server: http.Server | https.Server): Promise<void> {
    if (!server.listening) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  afterEach(async () => {
    for (const socket of sockets) socket.destroy();
    await Promise.all(servers.map(close));
  });

  it('posts JSON with bearer authorization and handles a trailing slash', async () => {
    let recorded: {
      method: string | undefined;
      url: string | undefined;
      authorization: string | undefined;
      body: unknown;
    } | undefined;

    const url = await listen(http.createServer((req, res) => {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk: string) => { body += chunk; });
      req.on('end', () => {
        recorded = {
          method: req.method,
          url: req.url,
          authorization: req.headers.authorization,
          body: JSON.parse(body),
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true,"state":"up"}');
      });
    }));

    const result = await postLive('on', { url: `${url}/`, token: 'tok' });

    expect(result).toMatchObject({
      ok: true,
      status: 200,
      body: { state: 'up' },
    });
    expect(recorded).toEqual({
      method: 'POST',
      url: '/api/piano/live',
      authorization: 'Bearer tok',
      body: { action: 'on' },
    });
  });

  it('returns an error containing the HTTP status and response message', async () => {
    const url = await listen(http.createServer((req, res) => {
      req.resume();
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end('{"error":"Unauthorized"}');
    }));

    const result = await postLive('off', { url, token: 'tok' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('401');
      expect(result.error).toContain('Unauthorized');
    }
  });

  it('returns an error when the server is unreachable', async () => {
    const server = http.createServer();
    const url = await listen(server);
    await close(server);

    const result = await postLive('on', { url, token: 'tok' });

    expect(result).toEqual({ ok: false, error: expect.any(String) });
  });

  it('times out when the server never replies', async () => {
    const url = await listen(http.createServer((req) => {
      req.resume();
    }));

    const result = await postLive('on', {
      url,
      token: 'tok',
      timeoutMs: 200,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('timed out');
  });

  it('requires a Pantheon certificate for HTTPS', async () => {
    const result = await postLive('on', {
      url: 'https://127.0.0.1',
      token: 'tok',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('no Pantheon certificate');
    }
  });

  withCerts('accepts the pinned certificate despite a hostname mismatch', async () => {
    const url = await listen(https.createServer({ cert, key }, (req, res) => {
      req.resume();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true,"state":"up"}');
    }));

    const result = await postLive('on', {
      url,
      token: 'tok',
      certPem: cert,
    });

    expect(result).toMatchObject({
      ok: true,
      status: 200,
      body: { state: 'up' },
    });
  });

  withCerts('rejects a different pinned certificate', async () => {
    const url = await listen(https.createServer({ cert, key }, (req, res) => {
      req.resume();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true,"state":"up"}');
    }));

    const result = await postLive('on', {
      url,
      token: 'tok',
      certPem: otherCert,
    });

    expect(result).toEqual({ ok: false, error: expect.any(String) });
  });
});
