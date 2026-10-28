import * as crypto from 'node:crypto';
import * as http from 'node:http';
import * as https from 'node:https';

export type InviteState = {
  active: boolean;
  since: number | null;
  endsAt: number | null;
};

export class InviteTimer {
  private readonly now: () => number;
  private current: InviteState = { active: false, since: null, endsAt: null };
  private timer: ReturnType<typeof setTimeout> | undefined;
  private noteAt: number | null = null;

  constructor(private readonly opts: {
    idleMs: number;
    onIdle: () => void;
    now?: () => number;
  }) {
    this.now = opts.now ?? Date.now;
  }

  start(): InviteState {
    if (this.current.active) return this.state();
    const now = this.now();
    this.current = { active: true, since: now, endsAt: now + this.opts.idleMs };
    this.arm();
    return this.state();
  }

  noteOn(): void {
    this.noteAt = this.now();
    if (!this.current.active) return;
    this.current.endsAt = this.noteAt + this.opts.idleMs;
    this.arm();
  }

  stop(): InviteState {
    this.clearTimer();
    this.current = { active: false, since: null, endsAt: null };
    return this.state();
  }

  state(): InviteState {
    return { ...this.current };
  }

  get lastNoteAt(): number | null {
    return this.noteAt;
  }

  dispose(): void {
    this.stop();
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private arm(): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      if (!this.current.active) return;
      this.stop();
      try {
        this.opts.onIdle();
      } catch { /* Keep callback failures contained. */ }
    }, this.opts.idleMs);
    this.timer.unref?.();
  }
}

type LiveResult =
  | { ok: true; status: number; body: unknown }
  | { ok: false; error: string };

export function postLive(action: 'on' | 'off', opts: {
  url: string;
  token: string;
  certPem?: string | null;
  timeoutMs?: number;
}): Promise<LiveResult> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let request: http.ClientRequest | undefined;

    const finish = (result: LiveResult): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve(result);
    };

    const fail = (error: unknown): void => {
      finish({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    };

    try {
      const url = new URL(`${opts.url.replace(/\/+$/, '')}/api/piano/live`);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        finish({ ok: false, error: 'unsupported protocol' });
        return;
      }

      const payload = JSON.stringify({ action });
      const options: https.RequestOptions = {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${opts.token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      };

      if (url.protocol === 'https:') {
        if (!opts.certPem) {
          finish({ ok: false, error: 'no Pantheon certificate' });
          return;
        }

        let pin: string;
        try {
          pin = new crypto.X509Certificate(opts.certPem).fingerprint256;
        } catch {
          finish({ ok: false, error: 'bad Pantheon certificate' });
          return;
        }

        options.ca = opts.certPem;
        options.rejectUnauthorized = true;
        options.agent = false;
        options.checkServerIdentity = (_host, cert) =>
          cert.fingerprint256 === pin
            ? undefined
            : new Error('Pantheon certificate does not match');
      }

      const transport = url.protocol === 'https:' ? https : http;
      request = transport.request(url, options, (response) => {
        let raw = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          raw += chunk;
        });
        response.on('error', fail);
        response.once('aborted', () => {
          finish({ ok: false, error: 'response aborted' });
        });
        response.once('close', () => {
          if (!response.complete) {
            finish({ ok: false, error: 'response closed' });
          }
        });
        response.once('end', () => {
          if (settled) return;

          let body: unknown = raw || null;
          if (raw) {
            try {
              body = JSON.parse(raw) as unknown;
            } catch { /* Keep non-JSON responses as text. */ }
          }

          const status = response.statusCode ?? 0;
          if (status >= 200 && status < 300) {
            finish({ ok: true, status, body });
            return;
          }

          let error = `HTTP ${status}`;
          if (body !== null && typeof body === 'object' &&
              'error' in body && typeof body.error === 'string') {
            error += `: ${body.error}`;
          }
          finish({ ok: false, error });
        });
      });

      request.on('error', fail);
      timer = setTimeout(() => {
        finish({ ok: false, error: 'timed out' });
        request?.destroy();
      }, opts.timeoutMs ?? 5000);
      request.end(payload);
    } catch (error) {
      fail(error);
      request?.destroy();
    }
  });
}
