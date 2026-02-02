import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionStore } from '../sessions/sessionStore.js';

export type HaloHomePaths = {
  root: string;
  config: string;
  docs: string;
  logs: string;
  memory: string;
};

export type GatewayStatus = {
  uptime: number;
  version: string | null;
  haloHome: HaloHomePaths;
  gateway: {
    host: string;
    port: number;
  };
};

export type StatusContext = {
  startedAtMs: number;
  host: string;
  port: number;
  version: string | null;
  haloHome: HaloHomePaths;
  sessionStore: SessionStore;
  now?: () => number;
};

export type StatusHandler = (
  req: { method?: string; url?: string },
  res: {
    statusCode: number;
    setHeader: (name: string, value: string) => void;
    end: (body?: string) => void;
  },
) => void | Promise<void>;

export type AdminServerOptions = {
  host: string;
  port: number;
  haloHome: string;
  version: string | null;
  sessionStore: SessionStore;
  startedAtMs?: number;
  now?: () => number;
};

export type AdminServer = {
  server: Server;
  handler: StatusHandler;
  context: StatusContext;
};

export function buildHaloHomePaths(root: string): HaloHomePaths {
  return {
    root,
    config: join(root, 'config'),
    docs: join(root, 'docs'),
    logs: join(root, 'logs'),
    memory: join(root, 'memory'),
  };
}

export async function resolveVersion(root: string): Promise<string | null> {
  if (process.env.npm_package_version) {
    return process.env.npm_package_version;
  }

  try {
    const raw = await readFile(join(root, 'package.json'), 'utf8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

export function createStatusPayload(context: StatusContext): GatewayStatus {
  const now = context.now ? context.now() : Date.now();
  const uptime = Math.max(0, (now - context.startedAtMs) / 1000);

  return {
    uptime,
    version: context.version,
    haloHome: context.haloHome,
    gateway: {
      host: context.host,
      port: context.port,
    },
  };
}

export function createStatusHandler(context: StatusContext): StatusHandler {
  return async (req, res) => {
    const sendJson = (statusCode: number, payload: unknown) => {
      res.statusCode = statusCode;
      res.setHeader('access-control-allow-origin', '*');
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(payload));
    };

    try {
      const path = req.url?.split('?')[0] ?? '';

      if (req.method === 'GET' && path === '/healthz') {
        // Keep this super lightweight so it stays reliable.
        sendJson(200, { ok: true });
        return;
      }

      if (req.method === 'GET' && path === '/status') {
        const payload = createStatusPayload(context);
        sendJson(200, payload);
        return;
      }

      if (req.method === 'GET' && path === '/sessions') {
        const scopeIds = context.sessionStore.listScopeIds().sort();
        sendJson(200, scopeIds);
        return;
      }

      if (req.method === 'POST' && path.startsWith('/sessions/') && path.endsWith('/clear')) {
        const rawScopeId = path.slice('/sessions/'.length, -'/clear'.length);
        if (!rawScopeId) {
          sendJson(404, { error: 'not_found' });
          return;
        }

        let scopeId: string;
        try {
          scopeId = decodeURIComponent(rawScopeId);
        } catch {
          sendJson(400, { error: 'invalid_scope_id' });
          return;
        }

        await context.sessionStore.clear(scopeId);
        sendJson(200, { ok: true, scopeId });
        return;
      }

      sendJson(404, { error: 'not_found' });
    } catch {
      sendJson(500, { error: 'internal_error' });
    }
  };
}

export async function startAdminServer(options: AdminServerOptions): Promise<AdminServer> {
  const context: StatusContext = {
    startedAtMs: options.startedAtMs ?? Date.now(),
    host: options.host,
    port: options.port,
    version: options.version,
    haloHome: buildHaloHomePaths(options.haloHome),
    sessionStore: options.sessionStore,
    now: options.now,
  };

  const handler = createStatusHandler(context);
  const server = createServer((req, res) => {
    void handler(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => {
      server.off('error', reject);
      const address = server.address();
      if (address && typeof address === 'object') {
        context.port = address.port;
      }
      resolve();
    });
  });

  return { server, handler, context };
}
