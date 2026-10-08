import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TutorApi, type RendererCommand } from '../src/main/tutorApi';

describe('TutorApi', () => {
  let api: TutorApi;
  let base: string;
  let commands: RendererCommand[];

  beforeEach(async () => {
    commands = [];
    api = new TutorApi({
      port: 0,
      token: 't',
      allowInject: true,
      sendToRenderer: (command) => { commands.push(command); },
    });
    base = `http://127.0.0.1:${await api.start()}`;
  });

  afterEach(async () => {
    await api.stop();
  });

  const request = (route: string, method = 'GET', body?: unknown) =>
    fetch(`${base}${route}`, {
      method,
      headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const playChord = () => {
    for (const note of [64, 67, 71]) {
      api.onNote({
        kind: 'noteon',
        note,
        velocity: 80,
        source: 'test',
        timestamp: Date.now(),
      });
    }
    for (const note of [64, 67, 71]) {
      api.onNote({
        kind: 'noteoff',
        note,
        velocity: 0,
        source: 'test',
        timestamp: Date.now(),
      });
    }
  };

  it('requires a bearer token', async () => {
    expect((await fetch(`${base}/state`)).status).toBe(401);
  });

  it('reports the state shape and merges renderer state', async () => {
    api.onRendererState({ page: 'practice' });
    api.onRendererState({ ready: true });
    api.onDevice({ connected: true, name: 'Test keyboard' });
    expect(await (await request('/state')).json()).toEqual({
      ok: true,
      rendererConnected: true,
      device: { connected: true, name: 'Test keyboard' },
      screen: { page: 'practice', ready: true },
      task: null,
      lastGestureId: 0,
      eventSeq: 0,
      injectEnabled: true,
    });
  });

  it('grades E minor and sends the result to the renderer', async () => {
    const response = await request('/task', 'POST', {
      label: 'Play E minor',
      notes: ['E', 'G', 'B'],
    });
    expect(response.status).toBe(200);
    expect((await response.json()).task.result).toBeNull();
    playChord();
    await vi.waitFor(async () => {
      const { task } = await (await request('/task')).json();
      expect(task.result?.verdict).toBe('correct');
    }, { timeout: 250, interval: 10 });
    expect(commands.some((command) =>
      command.type === 'task' && command.task.result?.verdict === 'correct',
    )).toBe(true);
    const { gesture, timedOut } = await (await request('/gestures/next?after=0')).json();
    expect(timedOut).toBe(false);
    expect(gesture.notes).toEqual([64, 67, 71]);
  });

  it('waits for the next gesture when after is omitted', async () => {
    const pending = request('/gestures/next?timeoutMs=1000');
    // Ensure the long-poll is registered before playing.
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    playChord();
    const { gesture, timedOut } = await (await pending).json();
    expect(timedOut).toBe(false);
    expect(gesture.notes).toEqual([64, 67, 71]);
  });

  it('times out a long-poll', async () => {
    expect(await (await request('/gestures/next?timeoutMs=100')).json()).toEqual({
      gesture: null,
      task: null,
      timedOut: true,
    });
  });

  it('sends injection commands without directly ingesting events', async () => {
    const response = await request('/inject', 'POST', {
      notes: [64, 67, 71],
      spreadMs: 5,
      holdMs: 20,
    });
    expect(await response.json()).toEqual({
      ok: true,
      label: 'INJECTED - not a real MIDI device',
    });
    await vi.waitFor(() => {
      expect(commands.filter((command) => command.type === 'inject')).toHaveLength(6);
    });
    for (const note of [64, 67, 71]) {
      expect(commands).toContainEqual({ type: 'inject', kind: 'noteon', note, velocity: 80 });
      expect(commands).toContainEqual({ type: 'inject', kind: 'noteoff', note, velocity: 80 });
    }
    expect((await (await request('/state')).json()).eventSeq).toBe(0);
  });

  it('rejects invalid MusicXML', async () => {
    expect((await request('/piece', 'POST', {
      title: 'Bad piece',
      musicxml: '<invalid />',
    })).status).toBe(400);
  });

  it('accepts a photo-only piece', async () => {
    const photo = 'data:image/jpeg;base64,/9j/4AAQ';
    expect((await request('/piece', 'POST', { title: 'Photo only', photo })).status).toBe(200);
    expect(commands).toContainEqual({ type: 'piece', title: 'Photo only', musicxml: '', photo });
  });

  it('rejects a piece with neither a score nor a photo, or a non-image photo', async () => {
    expect((await request('/piece', 'POST', { title: 'Empty' })).status).toBe(400);
    expect((await request('/piece', 'POST', {
      title: 'Text as photo',
      photo: 'data:text/html;base64,PGI+',
    })).status).toBe(400);
    expect(commands.filter((command) => command.type === 'piece')).toHaveLength(0);
  });
});
