// #5154 auto-invite e2e: Roland notes (inject) bring the tutor in; clicks, keys and on-screen
// keyboard notes never do; 10 min (IDLE_MS here) without a key lets it go; the next key brings
// it back; a button "off" is not undone by the next note. Helpers copied from e2e_invite.mjs.
// Launch a hidden packaged copy first (Solace), e.g.:
//   MIDITUTOR_ALLOW_INJECT=1 MIDITUTOR_HIDDEN=1 MIDITUTOR_PORT=47931 MIDITUTOR_AUTO_INVITE=on
//   MIDITUTOR_INVITE_IDLE_MS=4000 MIDITUTOR_PANTHEON_URL=http://127.0.0.1:47960
//   ./out/MidiTutor-win32-x64/MidiTutor.exe --mute-audio --user-data-dir=<ud> --remote-debugging-port=9333
// then: MIDITUTOR_TOKEN=$(cat <ud>/api-token) node --experimental-websocket scripts/e2e_auto_invite.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';

const API_PORT = Number(process.env.API_PORT ?? 47931);
const STUB_PORT = Number(process.env.STUB_PORT ?? 47960);
const CDP_PORT = Number(process.env.CDP_PORT ?? 9333);
const IDLE_MS = Number(process.env.IDLE_MS ?? 4000);

const posts = [];
const pending = new Map();
const controller = new AbortController();

let token;
let server;
let socket;
let nextId = 0;
let stubStatus = 200;
let passed = 0;
let failed = 0;
let stopping = false;

function check(cond, label, detail = null) {
  if (stopping) return Boolean(cond);
  if (cond) {
    passed++;
    console.log(`PASS ${label}`);
  } else {
    failed++;
    console.log(`FAIL ${label}  ${JSON.stringify(detail)}`);
  }
  return Boolean(cond);
}

async function waitFor(pred, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (!stopping) {
    try {
      const value = await pred();
      if (value) {
        check(true, label);
        return value;
      }
    } catch (error) {
      lastError = error.message;
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(100, remaining));
  }

  check(false, label, { timeoutMs, lastError });
  return null;
}

async function api(method, path, body) {
  const response = await fetch(`http://127.0.0.1:${API_PORT}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: controller.signal,
  });
  return response.json();
}

async function startStub() {
  server = createServer((request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('error', () => response.destroy());
    request.on('end', () => {
      let body = null;
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = null;
      }

      posts.push({
        method: request.method,
        url: request.url,
        auth: request.headers.authorization,
        body,
        at: Date.now(),
      });

      response.writeHead(stubStatus, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: stubStatus === 200 }));
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(STUB_PORT, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
}

function rejectPending(error) {
  for (const entry of pending.values()) entry.reject(error);
  pending.clear();
}

async function connectCDP() {
  const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`, {
    signal: controller.signal,
  });
  const targets = await response.json();
  const page = targets.find(target => target.type === 'page');
  if (!page?.webSocketDebuggerUrl) throw new Error('No CDP page target found');

  socket = new WebSocket(page.webSocketDebuggerUrl);

  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => {
      const error = new Error('CDP WebSocket error');
      reject(error);
      rejectPending(error);
    });
    socket.addEventListener('close', () => {
      const error = new Error('CDP WebSocket closed');
      reject(error);
      rejectPending(error);
    });
    socket.addEventListener('message', event => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch (error) {
        rejectPending(error);
        return;
      }

      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);

      if (message.error) {
        entry.reject(new Error(JSON.stringify(message.error)));
      } else if (message.result?.exceptionDetails) {
        entry.reject(new Error(JSON.stringify(message.result.exceptionDetails)));
      } else {
        entry.resolve(message.result?.result?.value);
      }
    });
  });
}

function evaluate(expression) {
  return new Promise((resolve, reject) => {
    if (socket?.readyState !== WebSocket.OPEN) {
      reject(new Error('CDP WebSocket is not open'));
      return;
    }

    const id = ++nextId;
    pending.set(id, { resolve, reject });

    try {
      socket.send(JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true },
      }));
    } catch (error) {
      pending.delete(id);
      reject(error);
    }
  });
}

const tutorButton = `Array.from(document.querySelectorAll('header button'))
  .find(button => /^(Bring in the tutor|Tutor on|Calling)/.test((button.textContent ?? '').trim()))`;

function buttonText() {
  return evaluate(`(${tutorButton})?.textContent?.trim() ?? null`);
}

function clickTutor() {
  return evaluate(`(() => {
    const button = ${tutorButton};
    if (!button) return false;
    button.click();
    return true;
  })()`);
}

function headerText() {
  return evaluate(`document.querySelector('header')?.textContent`);
}

function actionPosts(action) {
  return posts.filter(post => post.body?.action === action);
}

async function events() {
  const result = await api('GET', '/events?since=0&limit=2000');
  const list = Array.isArray(result) ? result : result.events;
  if (!Array.isArray(list)) throw new Error('Expected an events array');
  return list;
}

function hasEvent(list, kind, reason) {
  return list.some(event =>
    event.kind === kind &&
    (reason === undefined || (event.reason ?? event.data?.reason) === reason)
  );
}

const key = (note) => api('POST', '/inject', { notes: [note], kind: 'chord', holdMs: 80 });
const uiNote = (note) => evaluate(`window.tutorBridge.note({ kind: 'noteon', note: ${note}, velocity: 80,
  source: 'virtual', timestamp: Date.now() }) ?? true`);
const clickAround = () => evaluate(`(() => {
  const buttons = Array.from(document.querySelectorAll('nav button, [role=tab], header button'))
    .filter(b => !/(Bring in the tutor|Tutor on|Record)/.test(b.textContent ?? ''));
  for (const b of buttons.slice(0, 6)) b.click();
  for (const k of ['a', 'c', ' ', 'ArrowRight']) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true }));
  }
  document.body.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 200, bubbles: true }));
  return buttons.length;
})()`);
const state = () => api('GET', '/state');

async function run() {
  token = process.env.MIDITUTOR_TOKEN?.trim();
  if (!token) throw new Error('Set MIDITUTOR_TOKEN');
  await startStub();
  const initial = await waitFor(async () => {
    const s = await state();
    return s.rendererConnected === true ? s : null;
  }, 30_000, 'renderer connected');
  check(initial?.autoInvite === true, 'auto-invite reported on', initial?.autoInvite);
  check(initial?.invite?.active === false, 'starts off', initial?.invite);
  await connectCDP();

  const clicked = await clickAround();
  check(await uiNote(64), 'on-screen keyboard note sent');
  await sleep(1500);
  check(clicked > 0, 'clicked around the app', clicked);
  check(actionPosts('on').length === 0 && (await state()).invite?.active === false,
    'clicks, keys and on-screen notes do not bring the tutor in', posts);

  await key(60);
  await waitFor(() => actionPosts('on').length === 1, 5_000, 'Roland note sends on');
  await waitFor(async () => (await state()).invite?.active === true, 5_000, 'invite active after note');
  await waitFor(async () => (await buttonText())?.startsWith('Tutor on'), 5_000, 'button shows Tutor on');
  check(hasEvent(await events(), 'invite-on', 'notes'), 'invite-on event reason notes');
  const lastKey = Date.now();
  await key(62);
  await sleep(500);
  check(actionPosts('on').length === 1, 'further notes do not resend on', actionPosts('on').length);

  // Clicking around while on does not keep it alive: off arrives IDLE_MS after the last key.
  const ticker = setInterval(() => { void clickAround().catch(() => {}); }, 700);
  const off = await waitFor(() => actionPosts('off')[0], IDLE_MS + 4000, 'idle sends off');
  clearInterval(ticker);
  check(off && off.at - lastKey >= IDLE_MS - 200 && off.at - lastKey < IDLE_MS + 1500, 'clicks did not extend the invite',
    { afterLastKeyMs: off && off.at - lastKey, IDLE_MS });
  await waitFor(async () => (await state()).invite?.active === false, 5_000, 'off after idle');

  await key(65);
  await waitFor(() => actionPosts('on').length === 2, 5_000, 'next note brings it back on');
  await waitFor(async () => (await state()).invite?.active === true, 5_000, 'active again');

  check(await clickTutor(), 'press button off');
  await waitFor(async () => (await state()).invite?.active === false, 5_000, 'button turns it off');
  await key(67);
  await sleep(1500);
  check(actionPosts('on').length === 2 && (await state()).invite?.active === false,
    'a note right after button-off does not undo it', actionPosts('on').length);
}

let safetyTimer;
try {
  await Promise.race([
    new Promise((_, reject) => {
      safetyTimer = setTimeout(() => reject(new Error('Overall 60 s safety timeout')), 60_000);
    }),
    run(),
  ]);
} catch (error) {
  check(false, 'e2e_auto_invite', { error: error.message });
} finally {
  clearTimeout(safetyTimer);
  stopping = true;
  controller.abort();
  rejectPending(new Error('Test finished'));
  try { socket?.close(); } catch { /* already closed */ }
  if (server) await new Promise(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
  console.log(`e2e_auto_invite: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
