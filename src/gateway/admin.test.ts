import { describe, expect, it } from 'vitest';

import { buildHaloHomePaths, createStatusHandler } from './admin.js';
import { SessionStore } from '../sessions/sessionStore.js';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

type MockResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
};

const makeMockResponse = (): MockResponse => {
  const res: MockResponse = {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader: (name, value) => {
      res.headers[name.toLowerCase()] = value;
    },
    end: (body) => {
      res.body = body ?? '';
    },
  };

  return res;
};

const makeSessionStore = async () => {
  // SessionStore persists to disk by default. Use an isolated temp directory in tests
  // to avoid cross-test contamination from previous runs.
  const baseDir = await mkdtemp(path.join(os.tmpdir(), 'halo-sessions-'));
  return new SessionStore({ baseDir });
};

describe('gateway status handler', () => {
  it('returns ok for /healthz', async () => {
    const store = await makeSessionStore();
    const handler = createStatusHandler({
      startedAtMs: 0,
      host: '127.0.0.1',
      port: 7777,
      version: null,
      haloHome: buildHaloHomePaths('/halo'),
      sessionStore: store,
    });

    const res = makeMockResponse();
    await handler({ method: 'GET', url: '/healthz' }, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it('returns status payload for /status', async () => {
    const nowMs = 1_000_000;
    const store = await makeSessionStore();
    const context = {
      startedAtMs: nowMs - 5_000,
      host: '127.0.0.1',
      port: 7777,
      version: '1.2.3',
      haloHome: buildHaloHomePaths('/halo'),
      sessionStore: store,
      now: () => nowMs,
    };

    const handler = createStatusHandler(context);
    const res = makeMockResponse();

    await handler({ method: 'GET', url: '/status' }, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');

    const payload = JSON.parse(res.body) as {
      uptime: number;
      version: string | null;
      haloHome: Record<string, string>;
      gateway: { host: string; port: number };
    };

    expect(payload.uptime).toBe(5);
    expect(payload.version).toBe('1.2.3');
    expect(payload.haloHome.root).toBe('/halo');
    expect(payload.haloHome.memory).toBe('/halo/memory');
    expect(payload.haloHome.logs).toBe('/halo/logs');
    expect(payload.gateway).toEqual({ host: '127.0.0.1', port: 7777 });
  });

  it('returns scope ids for /sessions', async () => {
    const store = await makeSessionStore();
    store.getOrCreate('scope-2');
    store.getOrCreate('scope-1');

    const handler = createStatusHandler({
      startedAtMs: 0,
      host: '127.0.0.1',
      port: 7777,
      version: null,
      haloHome: buildHaloHomePaths('/halo'),
      sessionStore: store,
    });

    const res = makeMockResponse();
    await handler({ method: 'GET', url: '/sessions' }, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');

    const payload = JSON.parse(res.body) as string[];
    expect(payload).toEqual(['scope-1', 'scope-2']);
  });

  it('returns scope ids with item counts for /sessions-with-counts', async () => {
    const store = await makeSessionStore();
    const s1 = store.getOrCreate('scope-2');
    const s2 = store.getOrCreate('scope-1');

    await s1.addItems([
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'one' }],
      },
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'two' }],
      },
    ]);
    await s2.addItems([
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'solo' }],
      },
    ]);

    const handler = createStatusHandler({
      startedAtMs: 0,
      host: '127.0.0.1',
      port: 7777,
      version: null,
      haloHome: buildHaloHomePaths('/halo'),
      sessionStore: store,
    });

    const res = makeMockResponse();
    await handler({ method: 'GET', url: '/sessions-with-counts' }, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');

    const payload = JSON.parse(res.body) as Array<{ scopeId: string; itemCount: number }>;
    expect(payload).toEqual([
      { scopeId: 'scope-1', itemCount: 1 },
      { scopeId: 'scope-2', itemCount: 2 },
    ]);
  });

  it('clears a session for /sessions/:scopeId/clear', async () => {
    const store = await makeSessionStore();
    const s1 = store.getOrCreate('scope-1');
    const s2 = store.getOrCreate('scope-2');

    await s1.addItems([
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'hello' }],
      },
    ]);
    await s2.addItems([
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'world' }],
      },
    ]);

    const handler = createStatusHandler({
      startedAtMs: 0,
      host: '127.0.0.1',
      port: 7777,
      version: null,
      haloHome: buildHaloHomePaths('/halo'),
      sessionStore: store,
    });

    const res = makeMockResponse();
    await handler({ method: 'POST', url: '/sessions/scope-1/clear' }, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');

    const payload = JSON.parse(res.body) as { ok: boolean; scopeId: string };
    expect(payload.ok).toBe(true);
    expect(payload.scopeId).toBe('scope-1');
    expect((await s1.getItems()).length).toBe(0);
    expect((await s2.getItems()).length).toBe(1);
  });

  it('returns last N event lines for /events/tail', async () => {
    const store = await makeSessionStore();
    const haloHome = await mkdtemp(path.join(os.tmpdir(), 'halo-home-'));
    const logsDir = path.join(haloHome, 'logs');
    const logPath = path.join(logsDir, 'events.jsonl');
    const entries = [
      { ts: '1', type: 'one', data: {} },
      { ts: '2', type: 'two', data: {} },
      { ts: '3', type: 'three', data: {} },
    ];

    await mkdir(logsDir, { recursive: true });
    await writeFile(
      logPath,
      entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n',
      'utf8',
    );

    const handler = createStatusHandler({
      startedAtMs: 0,
      host: '127.0.0.1',
      port: 7777,
      version: null,
      haloHome: buildHaloHomePaths(haloHome),
      sessionStore: store,
    });

    const res = makeMockResponse();
    await handler(
      { method: 'GET', url: '/events/tail?lines=2', socket: { remoteAddress: '127.0.0.1' } },
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');

    const payload = JSON.parse(res.body) as Array<{ ts: string }>;
    expect(payload).toEqual(entries.slice(-2));
  });

  it('returns an empty array when the events log is missing', async () => {
    const store = await makeSessionStore();
    const haloHome = await mkdtemp(path.join(os.tmpdir(), 'halo-home-'));

    const handler = createStatusHandler({
      startedAtMs: 0,
      host: '127.0.0.1',
      port: 7777,
      version: null,
      haloHome: buildHaloHomePaths(haloHome),
      sessionStore: store,
    });

    const res = makeMockResponse();
    await handler(
      { method: 'GET', url: '/events/tail?lines=5', socket: { remoteAddress: '127.0.0.1' } },
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(JSON.parse(res.body)).toEqual([]);
  });

  it('rejects non-local requests for /events/tail', async () => {
    const store = await makeSessionStore();
    const handler = createStatusHandler({
      startedAtMs: 0,
      host: '127.0.0.1',
      port: 7777,
      version: null,
      haloHome: buildHaloHomePaths('/halo'),
      sessionStore: store,
    });

    const res = makeMockResponse();
    await handler(
      { method: 'GET', url: '/events/tail?lines=1', socket: { remoteAddress: '10.0.0.1' } },
      res,
    );

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: 'forbidden' });
  });
});
