import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadFamilyConfig } from '../runtime/familyConfig.js';
import {
  canManageOperationalControls,
  resolveLaneRetentionDays,
} from '../runtime/operationsPolicy.js';
import { appendOperationalAuditEvent } from '../runtime/operationsAudit.js';
import {
  createRuntimeBackup,
  restoreRuntimeBackup,
} from '../runtime/backupManager.js';
import { hashSessionId } from '../sessions/sessionHash.js';
import type { SessionStore } from '../sessions/sessionStore.js';
import { runDistillation } from '../memory/distillationRunner.js';
import {
  deleteLaneMemory,
  exportLaneMemory,
  runLaneRetention,
} from '../memory/laneOperations.js';
import { SemanticMemory, type SemanticMemoryConfig } from '../memory/semanticMemory.js';
import type { SemanticSyncStatusSnapshot } from '../memory/semanticSyncScheduler.js';
import {
  deleteScopeUploadedFile,
  listScopeUploadedFiles,
  purgeScopeUploadedFiles,
} from '../files/fileMemoryLifecycle.js';
import type {
  FileMemoryRetentionRunOptions,
  FileMemoryRetentionStatusSnapshot,
} from '../files/fileMemoryRetentionScheduler.js';

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
    fileMemory?: {
      enabled?: boolean;
      uploadEnabled?: boolean;
      maxFileSizeMb?: number;
      allowedExtensions?: string[];
      maxFilesPerScope?: number;
      pollIntervalMs?: number;
      includeSearchResults?: boolean;
      maxNumResults?: number;
      retention?: {
        enabled?: boolean;
        maxAgeDays?: number;
        runIntervalMinutes?: number;
        deleteOpenAIFiles?: boolean;
        maxFilesPerRun?: number;
        dryRun?: boolean;
        keepRecentPerScope?: number;
        maxDeletesPerScopePerRun?: number;
        allowScopeIds?: string[];
        denyScopeIds?: string[];
        policyPreset?: 'all' | 'parents_only' | 'exclude_children' | 'custom';
      };
    };
  };
  semanticSync?: SemanticSyncStatusSnapshot;
  fileRetention?: FileMemoryRetentionStatusSnapshot;
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
  fileRetentionStatusProvider?: () => FileMemoryRetentionStatusSnapshot;
  runFileRetentionNow?: (options?: FileMemoryRetentionRunOptions) => Promise<void>;
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

const parseBooleanQuery = (value: string | null, defaultValue: boolean): boolean => {
  if (value === null) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
};

const parseCsvQuery = (value: string | null): string[] | undefined => {
  if (value === null) return undefined;

  const parsed = Array.from(
    new Set(
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );

  return parsed.length > 0 ? parsed : undefined;
};

const parseMsQuery = (value: string | null): number | undefined => {
  if (value === null) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }
  return parsed;
};

const parseDateQuery = (value: string | null): Date | undefined => {
  if (value === null) {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed;
};

const decodePathParam = (raw: string): string | null => {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
};

type SessionFileRoute =
  | { kind: 'list'; scopeId: string }
  | { kind: 'purge'; scopeId: string }
  | { kind: 'delete'; scopeId: string; fileRef: string };

const matchSessionFileRoute = (path: string): SessionFileRoute | null => {
  const listMatch = path.match(/^\/sessions\/(.+)\/files$/);
  if (listMatch) {
    const scopeId = decodePathParam(listMatch[1]);
    if (!scopeId) return null;
    return { kind: 'list', scopeId };
  }

  const purgeMatch = path.match(/^\/sessions\/(.+)\/files\/purge$/);
  if (purgeMatch) {
    const scopeId = decodePathParam(purgeMatch[1]);
    if (!scopeId) return null;
    return { kind: 'purge', scopeId };
  }

  const deleteMatch = path.match(/^\/sessions\/(.+)\/files\/([^/]+)\/delete$/);
  if (deleteMatch) {
    const scopeId = decodePathParam(deleteMatch[1]);
    const fileRef = decodePathParam(deleteMatch[2]);
    if (!scopeId || !fileRef) return null;
    return { kind: 'delete', scopeId, fileRef };
  }

  return null;
};

type LaneMemoryRoute =
  | { kind: 'export'; laneId: string }
  | { kind: 'delete'; laneId: string }
  | { kind: 'retention'; laneId: string };

const matchLaneMemoryRoute = (path: string): LaneMemoryRoute | null => {
  const exportMatch = path.match(/^\/memory\/lanes\/(.+)\/export$/);
  if (exportMatch) {
    const laneId = decodePathParam(exportMatch[1]);
    if (!laneId) return null;
    return {
      kind: 'export',
      laneId,
    };
  }

  const deleteMatch = path.match(/^\/memory\/lanes\/(.+)\/delete$/);
  if (deleteMatch) {
    const laneId = decodePathParam(deleteMatch[1]);
    if (!laneId) return null;
    return {
      kind: 'delete',
      laneId,
    };
  }

  const retentionMatch = path.match(/^\/memory\/lanes\/(.+)\/retention\/run$/);
  if (retentionMatch) {
    const laneId = decodePathParam(retentionMatch[1]);
    if (!laneId) return null;
    return {
      kind: 'retention',
      laneId,
    };
  }

  return null;
};

const laneActionFromRouteKind = (
  kind: LaneMemoryRoute['kind'],
): 'lane_export' | 'lane_delete' | 'lane_retention' => {
  switch (kind) {
    case 'export':
      return 'lane_export';
    case 'delete':
      return 'lane_delete';
    case 'retention':
      return 'lane_retention';
  }
};

const laneMethodFromRouteKind = (kind: LaneMemoryRoute['kind']): 'GET' | 'POST' => {
  if (kind === 'export') {
    return 'GET';
  }

  return 'POST';
};

type BackupOperationsRoute =
  | { kind: 'create' }
  | { kind: 'restore' };

const matchBackupOperationsRoute = (path: string): BackupOperationsRoute | null => {
  if (path === '/operations/backup/create') {
    return { kind: 'create' };
  }

  if (path === '/operations/backup/restore') {
    return { kind: 'restore' };
  }

  return null;
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
  fileRetentionStatusProvider?: () => FileMemoryRetentionStatusSnapshot;
  runFileRetentionNow?: (options?: FileMemoryRetentionRunOptions) => Promise<void>;
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
    fileRetention: context.fileRetentionStatusProvider?.(),
  };
}

type OperationsActor = {
  family: Awaited<ReturnType<typeof loadFamilyConfig>>;
  memberId: string;
};

async function resolveOperationsActor(
  context: StatusContext,
  memberIdRaw: string | null,
): Promise<
  | { ok: true; actor: OperationsActor }
  | {
      ok: false;
      statusCode: number;
      payload: { error: string; reason?: string };
      audit?: {
        memberId: string;
        reason: string;
      };
    }
> {
  const memberId = memberIdRaw?.trim() ?? '';
  if (!memberId) {
    return {
      ok: false,
      statusCode: 400,
      payload: { error: 'missing_member_id' },
    };
  }

  const family = await loadFamilyConfig({ haloHome: context.haloHome.root });
  const decision = canManageOperationalControls(family, memberId);
  if (!decision.allow) {
    return {
      ok: false,
      statusCode: 403,
      payload: {
        error: 'operations_forbidden',
        reason: decision.reason,
      },
      audit: {
        memberId,
        reason: decision.reason,
      },
    };
  }

  return {
    ok: true,
    actor: {
      family,
      memberId,
    },
  };
}

async function writeOperationalAudit(
  context: StatusContext,
  input: {
    action:
      | 'lane_export'
      | 'lane_delete'
      | 'lane_retention'
      | 'backup_create'
      | 'backup_restore';
    actorMemberId: string;
    targetLaneId?: string;
    targetBackupId?: string;
    outcome: 'allowed' | 'denied' | 'failed';
    details?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await appendOperationalAuditEvent({
      rootDir: context.haloHome.root,
      ...input,
    });
  } catch {
    // Audit writes must not break operator endpoints.
  }
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

      if (req.method === 'POST' && path === '/file-retention/run') {
        if (!isLoopbackAddress(req.socket?.remoteAddress)) {
          sendJson(403, { error: 'forbidden' });
          return;
        }

        if (!context.config?.fileMemory?.enabled) {
          sendJson(409, { error: 'file_memory_disabled' });
          return;
        }

        if (!context.config?.fileMemory?.retention?.enabled) {
          sendJson(409, { error: 'file_retention_disabled' });
          return;
        }

        if (!context.runFileRetentionNow) {
          sendJson(503, { error: 'file_retention_unavailable' });
          return;
        }

        const url = new URL(req.url ?? '', 'http://localhost');
        const scopeId = url.searchParams.get('scopeId')?.trim() || undefined;
        const dryRun = parseBooleanQuery(
          url.searchParams.get('dryRun'),
          context.config?.fileMemory?.retention?.dryRun ?? false,
        );
        const uploadedBy = parseCsvQuery(url.searchParams.get('uploadedBy'));
        const extensions = parseCsvQuery(url.searchParams.get('extensions'));
        const mimePrefixes = parseCsvQuery(url.searchParams.get('mimePrefixes'));
        const uploadedAfterMs = parseMsQuery(url.searchParams.get('uploadedAfterMs'));
        const uploadedBeforeMs = parseMsQuery(url.searchParams.get('uploadedBeforeMs'));

        try {
          await context.runFileRetentionNow({
            scopeId,
            dryRun,
            uploadedBy,
            extensions,
            mimePrefixes,
            uploadedAfterMs,
            uploadedBeforeMs,
          });
        } catch (err) {
          sendJson(500, {
            error: 'file_retention_failed',
            message: err instanceof Error ? err.message : String(err),
          });
          return;
        }

        sendJson(200, {
          ok: true,
          requested: {
            scopeId: scopeId ?? null,
            dryRun,
            uploadedBy: uploadedBy ?? null,
            extensions: extensions ?? null,
            mimePrefixes: mimePrefixes ?? null,
            uploadedAfterMs: uploadedAfterMs ?? null,
            uploadedBeforeMs: uploadedBeforeMs ?? null,
          },
          status: context.fileRetentionStatusProvider?.(),
        });
        return;
      }

      const backupRoute = matchBackupOperationsRoute(path);
      if (backupRoute && req.method === 'POST') {
        if (!isLoopbackAddress(req.socket?.remoteAddress)) {
          sendJson(403, { error: 'forbidden' });
          return;
        }

        const url = new URL(req.url ?? '', 'http://localhost');
        const actorResolution = await resolveOperationsActor(
          context,
          url.searchParams.get('memberId'),
        );

        if (!actorResolution.ok) {
          if (actorResolution.audit) {
            await writeOperationalAudit(context, {
              action: backupRoute.kind === 'create' ? 'backup_create' : 'backup_restore',
              actorMemberId: actorResolution.audit.memberId,
              outcome: 'denied',
              details: {
                reason: actorResolution.audit.reason,
              },
            });
          }

          sendJson(actorResolution.statusCode, actorResolution.payload);
          return;
        }

        const actor = actorResolution.actor;

        try {
          if (backupRoute.kind === 'create') {
            const backupId = url.searchParams.get('backupId')?.trim() || undefined;
            const includePaths = parseCsvQuery(url.searchParams.get('includePaths'));
            const now = parseDateQuery(url.searchParams.get('now'));

            const backup = await createRuntimeBackup({
              rootDir: context.haloHome.root,
              backupId,
              includePaths,
              now,
            });

            await writeOperationalAudit(context, {
              action: 'backup_create',
              actorMemberId: actor.memberId,
              targetBackupId: backup.backupId,
              outcome: 'allowed',
              details: {
                includedPaths: backup.includedPaths,
                fileCount: backup.fileCount,
              },
            });

            sendJson(200, backup);
            return;
          }

          const backupId = url.searchParams.get('backupId')?.trim() ?? '';
          if (!backupId) {
            sendJson(400, { error: 'missing_backup_id' });
            return;
          }

          const restorePaths = parseCsvQuery(url.searchParams.get('restorePaths'));

          const restore = await restoreRuntimeBackup({
            rootDir: context.haloHome.root,
            backupId,
            restorePaths,
          });

          await writeOperationalAudit(context, {
            action: 'backup_restore',
            actorMemberId: actor.memberId,
            targetBackupId: restore.backupId,
            outcome: 'allowed',
            details: {
              restoredPaths: restore.restoredPaths,
            },
          });

          sendJson(200, restore);
          return;
        } catch (err) {
          await writeOperationalAudit(context, {
            action: backupRoute.kind === 'create' ? 'backup_create' : 'backup_restore',
            actorMemberId: actor.memberId,
            outcome: 'failed',
            details: {
              message: err instanceof Error ? err.message : String(err),
            },
          });

          sendJson(500, {
            error: 'backup_operation_failed',
            message: err instanceof Error ? err.message : String(err),
          });
          return;
        }
      }

      const laneMemoryRoute = matchLaneMemoryRoute(path);
      if (laneMemoryRoute) {
        const allowedMethod = laneMethodFromRouteKind(laneMemoryRoute.kind);
        if (req.method !== allowedMethod) {
          res.setHeader('allow', allowedMethod);
          sendJson(405, {
            error: 'method_not_allowed',
            allowed: [allowedMethod],
          });
          return;
        }

        if (!isLoopbackAddress(req.socket?.remoteAddress)) {
          sendJson(403, { error: 'forbidden' });
          return;
        }

        const url = new URL(req.url ?? '', 'http://localhost');
        const actorResolution = await resolveOperationsActor(
          context,
          url.searchParams.get('memberId'),
        );

        if (!actorResolution.ok) {
          if (actorResolution.audit) {
            await writeOperationalAudit(context, {
              action: laneActionFromRouteKind(laneMemoryRoute.kind),
              actorMemberId: actorResolution.audit.memberId,
              targetLaneId: laneMemoryRoute.laneId,
              outcome: 'denied',
              details: {
                reason: actorResolution.audit.reason,
              },
            });
          }

          sendJson(actorResolution.statusCode, actorResolution.payload);
          return;
        }

        const actor = actorResolution.actor;

        if (laneMemoryRoute.kind === 'export') {
          const exported = await exportLaneMemory({
            rootDir: context.haloHome.root,
            laneId: laneMemoryRoute.laneId,
          });

          await writeOperationalAudit(context, {
            action: 'lane_export',
            actorMemberId: actor.memberId,
            targetLaneId: laneMemoryRoute.laneId,
            outcome: 'allowed',
            details: {
              dailyFileCount: exported.dailyFiles.length,
            },
          });

          sendJson(200, exported);
          return;
        }

        if (laneMemoryRoute.kind === 'delete') {
          const deleted = await deleteLaneMemory({
            rootDir: context.haloHome.root,
            laneId: laneMemoryRoute.laneId,
          });

          await writeOperationalAudit(context, {
            action: 'lane_delete',
            actorMemberId: actor.memberId,
            targetLaneId: laneMemoryRoute.laneId,
            outcome: 'allowed',
            details: {
              deleted: deleted.deleted,
              trashPath: deleted.trashPath,
            },
          });

          sendJson(200, deleted);
          return;
        }

        const overrideDaysRaw = url.searchParams.get('retentionDays');
        const overrideDays =
          overrideDaysRaw === null
            ? null
            : Number.parseInt(overrideDaysRaw, 10);

        const configuredDays = resolveLaneRetentionDays(
          actor.family,
          laneMemoryRoute.laneId,
        );

        const retentionDays =
          overrideDays !== null && Number.isFinite(overrideDays)
            ? overrideDays
            : configuredDays;

        if (!retentionDays || retentionDays <= 0) {
          sendJson(409, {
            error: 'lane_retention_policy_missing',
          });
          return;
        }

        const dryRun = parseBooleanQuery(url.searchParams.get('dryRun'), false);
        const now = parseDateQuery(url.searchParams.get('now'));

        const summary = await runLaneRetention({
          rootDir: context.haloHome.root,
          laneId: laneMemoryRoute.laneId,
          retentionDays,
          dryRun,
          now,
        });

        await writeOperationalAudit(context, {
          action: 'lane_retention',
          actorMemberId: actor.memberId,
          targetLaneId: laneMemoryRoute.laneId,
          outcome: 'allowed',
          details: {
            retentionDays,
            dryRun,
            deletedCount: summary.deletedFiles.length,
          },
        });

        sendJson(200, summary);
        return;
      }

      const sessionFileRoute = matchSessionFileRoute(path);
      if (sessionFileRoute) {
        if (!context.config?.fileMemory?.enabled) {
          sendJson(409, { error: 'file_memory_disabled' });
          return;
        }

        const url = new URL(req.url ?? '', 'http://localhost');

        if (sessionFileRoute.kind === 'list' && req.method === 'GET') {
          const payload = await listScopeUploadedFiles({
            rootDir: context.haloHome.root,
            scopeId: sessionFileRoute.scopeId,
          });
          sendJson(200, payload);
          return;
        }

        if (sessionFileRoute.kind === 'delete' && req.method === 'POST') {
          if (!isLoopbackAddress(req.socket?.remoteAddress)) {
            sendJson(403, { error: 'forbidden' });
            return;
          }

          const deleteOpenAIFile = parseBooleanQuery(
            url.searchParams.get('deleteOpenAIFile'),
            false,
          );

          const result = await deleteScopeUploadedFile({
            rootDir: context.haloHome.root,
            scopeId: sessionFileRoute.scopeId,
            fileRef: sessionFileRoute.fileRef,
            deleteOpenAIFile,
          });

          if (!result.ok) {
            if (result.code === 'scope_not_found' || result.code === 'file_not_found') {
              sendJson(404, { error: result.code, message: result.message });
              return;
            }

            sendJson(502, { error: result.code, message: result.message });
            return;
          }

          sendJson(200, result);
          return;
        }

        if (sessionFileRoute.kind === 'purge' && req.method === 'POST') {
          if (!isLoopbackAddress(req.socket?.remoteAddress)) {
            sendJson(403, { error: 'forbidden' });
            return;
          }

          const deleteOpenAIFiles = parseBooleanQuery(
            url.searchParams.get('deleteOpenAIFiles'),
            false,
          );

          const result = await purgeScopeUploadedFiles({
            rootDir: context.haloHome.root,
            scopeId: sessionFileRoute.scopeId,
            deleteOpenAIFiles,
          });

          sendJson(200, result);
          return;
        }
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
    fileRetentionStatusProvider: options.fileRetentionStatusProvider,
    runFileRetentionNow: options.runFileRetentionNow,
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
