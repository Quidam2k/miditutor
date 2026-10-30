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

async function run() {
  for (const [name, value] of Object.entries({ API_PORT, STUB_PORT, CDP_PORT })) {
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
      throw new Error(`Invalid ${name}: ${value}`);
    }
  }
  if (!Number.isFinite(IDLE_MS) || IDLE_MS <= 0) {
    throw new Error(`Invalid IDLE_MS: ${IDLE_MS}`);
  }

  token = process.env.MIDITUTOR_TOKEN?.trim();
  if (!token) {
    if (!process.env.APPDATA) {
      throw new Error('Set MIDITUTOR_TOKEN or APPDATA to locate the API token');
    }
    token = (await readFile(
      join(process.env.APPDATA, 'MidiTutor', 'api-token'),
      'utf8',
    )).trim();
  }
  if (!token) throw new Error('API token is empty');

  await startStub();

  const initial = await waitFor(async () => {
    const state = await api('GET', '/state');
    return state.rendererConnected === true ? state : null;
  }, 30_000, 'renderer connected');

  check(
    isDeepStrictEqual(initial?.invite, {
      active: false,
      since: null,
      endsAt: null,
    }),
    'initial invite state',
    initial?.invite,
  );

  await connectCDP();
  await waitFor(
    async () => await buttonText() === 'Bring in the tutor',
    10_000,
    'invite button ready',
  );

  check(await clickTutor(), 'press invite button');
  await waitFor(() => posts.length === 1, 5_000, 'first stub request received');
  check(
    posts[0]?.method === 'POST' &&
    posts[0]?.url === '/api/piano/live' &&
    posts[0]?.auth === `Bearer ${token}` &&
    isDeepStrictEqual(posts[0]?.body, { action: 'on' }),
    'invite sends authenticated on request',
    posts[0] ? {
      method: posts[0].method,
      url: posts[0].url,
      authMatches: posts[0].auth === `Bearer ${token}`,
      body: posts[0].body,
    } : null,
  );

  const active = await waitFor(async () => {
    const state = await api('GET', '/state');
    return state.invite?.active === true &&
      (await buttonText())?.startsWith('Tutor on') ? state : null;
  }, 5_000, 'invite active and button updated');

  // #10171: with IDLE_MS=125000 the label starts at "3 min left", drops to "2" once under
  // two minutes, and a note puts it back to "3". Only this part runs at that length.
  if (IDLE_MS >= 60_000) {
    check((await buttonText())?.includes('3 min left'), 'label starts full', await buttonText());
    await waitFor(
      async () => (await buttonText())?.includes('2 min left'),
      20_000,
      'label counts down',
    );
    await api('POST', '/inject', { notes: [60], kind: 'chord', holdMs: 100 });
    await waitFor(
      async () => (await buttonText())?.includes('3 min left'),
      3_000,
      'a note puts the label back to full',
    );
    check(await clickTutor(), 'press button to end invite');
    await waitFor(async () => (await api('GET', '/state')).invite?.active === false, 5_000, 'invite ended');
    return;
  }

  const previousEndsAt = active?.invite?.endsAt;
  const duration = active?.invite?.endsAt - active?.invite?.since;
  check(
    Number.isFinite(duration) && Math.abs(duration - IDLE_MS) <= 50,
    'invite idle duration',
    { expected: IDLE_MS, actual: duration },
  );

  await sleep(1500);
  const injectAt = Date.now();
  await api('POST', '/inject', { notes: [60], kind: 'chord', holdMs: 100 });

  await waitFor(async () => {
    const state = await api('GET', '/state');
    return state.lastNoteAt != null &&
      state.invite?.endsAt > previousEndsAt + 1000;
  }, 5_000, 'injected note extends invite deadline');

  const idleOff = await waitFor(
    () => actionPosts('off')[0],
    IDLE_MS + 3000,
    'idle sends off request',
  );

  await waitFor(async () => {
    const state = await api('GET', '/state');
    return state.invite?.active === false;
  }, 5_000, 'invite inactive after idle');

  check(
    Boolean(idleOff) && idleOff.at >= injectAt + IDLE_MS - 200,
    'idle off respects extended deadline',
    { injectAt, offAt: idleOff?.at, minimumOffAt: injectAt + IDLE_MS - 200 },
  );

  let list = await events();
  check(hasEvent(list, 'invite-off', 'idle'), 'idle off event recorded');
  check(hasEvent(list, 'invite-on', 'button'), 'button on event recorded');

  await waitFor(
    async () => await buttonText() === 'Bring in the tutor',
    5_000,
    'invite button restored after idle',
  );

  const onCount = actionPosts('on').length;
  check(await clickTutor(), 'press invite button again');
  await waitFor(
    () => actionPosts('on').length === onCount + 1,
    5_000,
    'second on request received',
  );
  await waitFor(async () => {
    const state = await api('GET', '/state');
    return state.invite?.active === true;
  }, 5_000, 'second invite active');

  const offCount = actionPosts('off').length;
  check(await clickTutor(), 'press button to end invite');
  await waitFor(
    () => actionPosts('off').length === offCount + 1,
    5_000,
    'button sends another off request',
  );
  await waitFor(async () => {
    const state = await api('GET', '/state');
    return state.invite?.active === false;
  }, 5_000, 'button ends invite');

  list = await events();
  check(hasEvent(list, 'invite-off', 'button'), 'button off event recorded');

  stubStatus = 500;
  try {
    check(await clickTutor(), 'press invite button with failing Pantheon');
    await waitFor(
      async () => (await headerText())?.includes("Couldn't reach Pantheon"),
      5_000,
      'Pantheon failure shown in header',
    );

    const state = await api('GET', '/state');
    check(
      state.invite?.active === false,
      'failed invite remains inactive',
      state.invite,
    );

    list = await events();
    check(hasEvent(list, 'invite-error'), 'invite error event recorded');
  } finally {
    stubStatus = 200;
  }
}

let safetyTimer;

try {
  await Promise.race([
    new Promise((_, reject) => {
      safetyTimer = setTimeout(
        () => reject(new Error('Overall 60 s safety timeout')),
        60_000,
      );
    }),
    run(),
  ]);
} catch (error) {
  check(false, 'e2e_invite', { error: error.message });
} finally {
  clearTimeout(safetyTimer);
  stopping = true;
  controller.abort();
  rejectPending(new Error('Test finished'));

  try {
    socket?.close();
  } catch {
    // The connection may already be closed.
  }

  if (server) {
    await new Promise(resolve => {
      server.close(error => {
        if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
          failed++;
          console.log(`FAIL close stub  ${JSON.stringify({ error: error.message })}`);
        }
        resolve();
      });
      server.closeAllConnections();
    });
  }

  console.log(`e2e_invite: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
