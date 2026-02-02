import { describe, expect, it } from 'vitest';

import { buildHaloHomePaths, createStatusHandler } from './admin.js';

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
  it('returns status payload for /status', () => {
    const nowMs = 1_000_000;
    const context = {
      startedAtMs: nowMs - 5_000,
      host: '127.0.0.1',
      port: 7777,
      version: '1.2.3',
      haloHome: buildHaloHomePaths('/halo'),
      now: () => nowMs,
    };

    const handler = createStatusHandler(context);
    const res = makeMockResponse();

    handler({ method: 'GET', url: '/status' }, res);

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
});
