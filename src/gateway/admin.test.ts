import { describe, expect, it } from 'vitest';

import { buildHaloHomePaths, createStatusHandler } from './admin.js';
import { SessionStore } from '../sessions/sessionStore.js';

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

describe('gateway status handler', () => {
  it('returns ok for /healthz', async () => {
    const store = new SessionStore();
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
    const store = new SessionStore();
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
    const store = new SessionStore();
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

  it('clears a session for /sessions/:scopeId/clear', async () => {
    const store = new SessionStore();
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
});
