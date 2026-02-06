import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadFamilyConfig } from '../runtime/familyConfig.js';
import { hashSessionId } from '../sessions/sessionHash.js';
import type { SessionStore } from '../sessions/sessionStore.js';
import { runDistillation } from '../memory/distillationRunner.js';
import { SemanticMemory, type SemanticMemoryConfig } from '../memory/semanticMemory.js';
import type { SemanticSyncStatusSnapshot } from '../memory/semanticSyncScheduler.js';

export type HaloHomePaths = {
  root: string;
  config: string;
  docs: string;
  logs: string;
  memory: string;
};

type GatewayStatus = {
  uptime: number;
  version: string | null;
  haloHome: HaloHomePaths;
  gateway: {
    host: string;
    port: number;
  };
  config?: {
    schemaVersion?: number;
    gateway?: {
      host?: string;
      port?: number;
    };
    features?: {
      compactionEnabled?: boolean;
      distillationEnabled?: boolean;
    };
    memory?: {
      distillationEveryNItems?: number;
      distillationMaxItems?: number;
      distillationMode?: 'deterministic' | 'llm';
    };
    childSafe?: {
      enabled?: boolean;
      maxMessageLength?: number;
      blockedTopics?: string[];
    };
    semanticMemory?: {
      enabled?: boolean;
      embeddingProvider?: 'openai' | 'gemini';
      embeddingModel?: string;
      embeddingDimensions?: number;
      vecExtensionPath?: string;
      syncIntervalMinutes?: number;
      search?: {
        fusionMethod?: 'rrf';
        vectorWeight?: number;
        textWeight?: number;
        minScore?: number;
      };
    };
  };
  semanticSync?: SemanticSyncStatusSnapshot;
};

type PolicyScopeStatus = {
  scopeId: string;
  scopeType: 'dm' | 'parents_group';
  allow: boolean;
  reason?: 'group_not_approved' | 'child_in_parents_group';
  memberId?: string;
  role?: 'parent' | 'child';
  displayName?: string;
};

type PolicyStatusPayload = {
  scopes: PolicyScopeStatus[];
};

export type StatusContext = {
  startedAtMs: number;
  host: string;
  port: number;
  version: string | null;
  haloHome: HaloHomePaths;
  sessionStore: SessionStore;
  config?: GatewayStatus['config'];
  semanticSyncStatusProvider?: () => SemanticSyncStatusSnapshot;
  now?: () => number;
};

export type StatusHandler = (
  req: {
    method?: string;
    url?: string;
    socket?: { remoteAddress?: string | null };
  },
  res: {
    statusCode: number;
    setHeader: (name: string, value: string) => void;
    end: (body?: string) => void;
  },
) => void | Promise<void>;

const DEFAULT_TAIL_LINES = 50;

const isLoopbackAddress = (address?: string | null) => {
  if (!address) return false;
  if (address === '::1') return true;
  if (address.startsWith('::ffff:127.')) return true;
  return address.startsWith('127.');
};

const parseTailLines = (value: string | null) => {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TAIL_LINES;
  }
  return parsed;
};

const parseJsonLine = (line: string) => {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return line;
  }
};

const buildPolicyStatus = async (haloHome: string): Promise<PolicyStatusPayload> => {
  const family = await loadFamilyConfig({ haloHome });
  const scopes: PolicyScopeStatus[] = [];

  for (const member of family.members) {
    scopes.push({
      scopeId: `telegram:dm:${member.memberId}`,
      scopeType: 'dm',
      allow: true,
      memberId: member.memberId,
      role: member.role,
      displayName: member.displayName,
    });
  }

  const parentsGroupId = family.parentsGroup?.telegramChatId ?? null;
  if (!parentsGroupId) {
    scopes.push({
      scopeId: 'telegram:parents_group:unset',
      scopeType: 'parents_group',
      allow: false,
      reason: 'group_not_approved',
    });
    return { scopes };
  }

  for (const member of family.members) {
    const allow = member.role === 'parent';
    scopes.push({
      scopeId: `telegram:parents_group:${parentsGroupId}`,
      scopeType: 'parents_group',
      allow,
      reason: allow ? undefined : 'child_in_parents_group',
      memberId: member.memberId,
      role: member.role,
      displayName: member.displayName,
    });
  }

  return { scopes };
};

const readTail = async (path: string, lines: number) => {
  if (lines <= 0) return [];
  try {
    const raw = await readFile(path, 'utf8');
    const entries = raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const tail = entries.length > lines ? entries.slice(-lines) : entries;
    return tail.map(parseJsonLine);
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err) {
      const { code } = err as { code?: string };
      if (code === 'ENOENT') {
        return [];
      }
    }
    throw err;
  }
};

const readTranscript = async (path: string) => {
  try {
    const raw = await readFile(path, 'utf8');
    const entries = raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    return entries.map(parseJsonLine);
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err) {
      const { code } = err as { code?: string };
      if (code === 'ENOENT') {
        return [];
      }
    }
    throw err;
  }
};

export type AdminServerOptions = {
  host: string;
  port: number;
  haloHome: string;
  version: string | null;
  sessionStore: SessionStore;
  config?: GatewayStatus['config'];
  semanticSyncStatusProvider?: () => SemanticSyncStatusSnapshot;
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

function createStatusPayload(context: StatusContext): GatewayStatus {
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
    config: context.config,
    semanticSync: context.semanticSyncStatusProvider?.(),
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

      if (req.method === 'GET' && path === '/sessions-with-counts') {
        const scopeIds = context.sessionStore.listScopeIds().sort();
        const summaries = await Promise.all(
          scopeIds.map(async (scopeId) => {
            const session = context.sessionStore.getOrCreate(scopeId);
            const items = await session.getItems();
            return { scopeId, itemCount: items.length };
          }),
        );
        sendJson(200, summaries);
        return;
      }

      if (req.method === 'GET' && path === '/policy/status') {
        const payload = await buildPolicyStatus(context.haloHome.root);
        sendJson(200, payload);
        return;
      }

      if (req.method === 'GET' && path === '/events/tail') {
        if (!isLoopbackAddress(req.socket?.remoteAddress)) {
          sendJson(403, { error: 'forbidden' });
          return;
        }

        const url = new URL(req.url ?? '', 'http://localhost');
        const lines = parseTailLines(url.searchParams.get('lines'));
        const logPath = join(context.haloHome.logs, 'events.jsonl');
        const payload = await readTail(logPath, lines);
        sendJson(200, payload);
        return;
      }

      if (req.method === 'GET' && path === '/transcripts/tail') {
        if (!isLoopbackAddress(req.socket?.remoteAddress)) {
          sendJson(403, { error: 'forbidden' });
          return;
        }

        const url = new URL(req.url ?? '', 'http://localhost');
        const scopeId = url.searchParams.get('scopeId')?.trim() ?? '';
        if (!scopeId) {
          sendJson(400, { error: 'missing_scope_id' });
          return;
        }

        const lines = parseTailLines(url.searchParams.get('lines'));
        const transcriptPath = join(
          context.haloHome.root,
          'transcripts',
          `${hashSessionId(scopeId)}.jsonl`,
        );
        const payload = await readTail(transcriptPath, lines);
        sendJson(200, payload);
        return;
      }

      if (req.method === 'GET' && path.startsWith('/sessions/') && path.endsWith('/transcript')) {
        const rawScopeId = path.slice('/sessions/'.length, -'/transcript'.length);
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

        const url = new URL(req.url ?? '', 'http://localhost');
        const role = url.searchParams.get('role')?.trim();
        if (role !== 'parent') {
          sendJson(403, { error: 'forbidden' });
          return;
        }

        const family = await loadFamilyConfig({ haloHome: context.haloHome.root });
        const member = family.members.find(
          (entry) => scopeId === `telegram:dm:${entry.memberId}`,
        );

        if (!member || member.role !== 'child') {
          sendJson(403, { error: 'forbidden' });
          return;
        }

        const ageGroup = member.ageGroup ?? 'child';
        const allowTranscript =
          ageGroup === 'child' ? true : Boolean(member.parentalVisibility);

        if (!allowTranscript) {
          sendJson(403, { error: 'forbidden' });
          return;
        }

        const transcriptPath = join(
          context.haloHome.root,
          'transcripts',
          `${hashSessionId(scopeId)}.jsonl`,
        );
        const payload = await readTranscript(transcriptPath);
        sendJson(200, payload);
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

      if (req.method === 'POST' && path.startsWith('/sessions/') && path.endsWith('/distill')) {
        const rawScopeId = path.slice('/sessions/'.length, -'/distill'.length);
        if (!rawScopeId) {
          sendJson(400, { error: 'missing_scope_id' });
          return;
        }

        let scopeId: string;
        try {
          scopeId = decodeURIComponent(rawScopeId);
        } catch {
          sendJson(400, { error: 'invalid_scope_id' });
          return;
        }

        if (context.config?.features?.distillationEnabled === false) {
          sendJson(409, { error: 'distillation_disabled' });
          return;
        }

        const session = context.sessionStore.getOrCreate(scopeId);
        const items = await session.getItems();
        const mode = context.config?.memory?.distillationMode ?? 'deterministic';
        const result = await runDistillation({
          rootDir: context.haloHome.root,
          scopeId,
          items,
          mode,
        });

        sendJson(200, {
          ok: true,
          scopeId,
          durableFacts: result.durableFacts,
          temporalNotes: result.temporalNotes,
        });
        return;
      }

      if (req.method === 'POST' && path.startsWith('/sessions/') && path.endsWith('/semantic-sync')) {
        const rawScopeId = path.slice('/sessions/'.length, -'/semantic-sync'.length);
        if (!rawScopeId) {
          sendJson(400, { error: 'missing_scope_id' });
          return;
        }

        let scopeId: string;
        try {
          scopeId = decodeURIComponent(rawScopeId);
        } catch {
          sendJson(400, { error: 'invalid_scope_id' });
          return;
        }

        const semanticConfig = context.config?.semanticMemory;
        if (!semanticConfig?.enabled) {
          sendJson(409, { error: 'semantic_memory_disabled' });
          return;
        }

        try {
          const memory = new SemanticMemory({
            rootDir: context.haloHome.root,
            scopeId,
            semanticConfig: semanticConfig as SemanticMemoryConfig,
          });
          await memory.sync(semanticConfig as SemanticMemoryConfig);
          sendJson(200, { ok: true, scopeId });
        } catch (err) {
          sendJson(500, {
            error: 'sync_failed',
            message: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      if (req.method === 'POST' && path.startsWith('/sessions/') && path.endsWith('/purge')) {
        if (!isLoopbackAddress(req.socket?.remoteAddress)) {
          sendJson(403, { error: 'forbidden' });
          return;
        }

        const rawScopeId = path.slice('/sessions/'.length, -'/purge'.length);
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

        const url = new URL(req.url ?? '', 'http://localhost');
        const confirm = url.searchParams.get('confirm');
        if (confirm !== scopeId) {
          sendJson(400, { error: 'confirm_required' });
          return;
        }

        await context.sessionStore.purge(scopeId);
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
    config: options.config,
    semanticSyncStatusProvider: options.semanticSyncStatusProvider,
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
