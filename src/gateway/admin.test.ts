import { describe, expect, it, vi } from 'vitest';
import type { AgentInputItem } from '@openai/agents';

import { buildHaloHomePaths, createStatusHandler } from './admin.js';
import { SessionStore } from '../sessions/sessionStore.js';
import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { hashSessionId } from '../sessions/sessionHash.js';
import {
  readScopeFileRegistry,
  setScopeVectorStoreId,
  upsertScopeFileRecord,
} from '../files/scopeFileRegistry.js';
import {
  appendLaneDailyNotesUnique,
  appendLaneLongTermFacts,
  getLaneLongTermPath,
} from '../memory/laneMemory.js';

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

const makeSessionStore = async (rootDir?: string) => {
  // SessionStore persists to disk by default. Use an isolated temp directory in tests
  // to avoid cross-test contamination from previous runs.
  const baseRoot = rootDir ?? (await mkdtemp(path.join(os.tmpdir(), 'halo-sessions-')));
  return new SessionStore({
    baseDir: path.join(baseRoot, 'sessions'),
    transcriptsDir: path.join(baseRoot, 'transcripts'),
    rootDir: baseRoot,
    compactionEnabled: false,
    distillationEnabled: false,
  });
};

const userMessage = (text: string): AgentInputItem => ({
  type: 'message',
  role: 'user',
  content: [{ type: 'input_text', text }],
});

const writeFamilyConfig = async (rootDir: string) => {
  const configDir = path.join(rootDir, 'config');
  await mkdir(configDir, { recursive: true });
  const payload = {
    schemaVersion: 1,
    familyId: 'test-family',
    members: [
      {
        memberId: 'parent-1',
        displayName: 'Pat',
        role: 'parent',
        telegramUserIds: [111],
      },
      {
        memberId: 'child-1',
        displayName: 'Kid',
        role: 'child',
        ageGroup: 'child',
        telegramUserIds: [222],
      },
      {
        memberId: 'teen-1',
        displayName: 'Teen',
        role: 'child',
        ageGroup: 'teen',
        parentalVisibility: true,
        telegramUserIds: [333],
      },
    ],
    parentsGroup: { telegramChatId: 999 },
  };
  await writeFile(path.join(configDir, 'family.json'), JSON.stringify(payload), 'utf8');
  return payload;
};

const writeControlPlaneFamilyConfig = async (rootDir: string) => {
  const configDir = path.join(rootDir, 'config');
  await mkdir(configDir, { recursive: true });

  await writeFile(
    path.join(rootDir, 'config.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        controlPlane: {
          activeProfile: 'v2',
          profiles: {
            v2: {
              path: 'config/control-plane.json',
            },
          },
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  const controlPlane = {
    schemaVersion: 2,
    policyVersion: 'v2',
    familyId: 'test-family',
    activeProfileId: 'default_household',
    profiles: [
      {
        profileId: 'parent_default',
        role: 'parent',
        capabilityTierId: 'cap_parent',
        memoryLanePolicyId: 'lane_parent',
        modelPolicyId: 'model_parent',
        safetyPolicyId: 'safety_parent',
      },
      {
        profileId: 'young_child',
        role: 'child',
        capabilityTierId: 'cap_child',
        memoryLanePolicyId: 'lane_child',
        modelPolicyId: 'model_child',
        safetyPolicyId: 'safety_child',
      },
    ],
    members: [
      {
        memberId: 'parent-1',
        displayName: 'Pat',
        role: 'parent',
        profileId: 'parent_default',
        telegramUserIds: [111],
      },
      {
        memberId: 'parent-2',
        displayName: 'Lee',
        role: 'parent',
        profileId: 'parent_default',
        telegramUserIds: [112],
      },
      {
        memberId: 'child-1',
        displayName: 'Kid',
        role: 'child',
        profileId: 'young_child',
        telegramUserIds: [222],
      },
    ],
    scopes: [
      {
        scopeId: 'telegram:parents_group:999',
        scopeType: 'parents_group',
        telegramChatId: 999,
      },
      {
        scopeId: 'telegram:family_group:888',
        scopeType: 'family_group',
        telegramChatId: 888,
      },
    ],
    capabilityTiers: {
      cap_parent: ['chat.respond'],
      cap_child: ['chat.respond'],
    },
    memoryLanePolicies: {
      lane_parent: {
        readLanes: ['parent_private:{memberId}', 'parents_shared', 'family_shared'],
        writeLanes: ['parent_private:{memberId}'],
      },
      lane_child: {
        readLanes: ['child_private:{memberId}', 'family_shared'],
        writeLanes: ['child_private:{memberId}'],
      },
    },
    modelPolicies: {
      model_parent: {
        tier: 'parent_default',
        model: 'gpt-5.1',
        reason: 'parent_dm',
      },
      model_child: {
        tier: 'child_default',
        model: 'gpt-5.1-mini',
        reason: 'child_dm',
      },
    },
    safetyPolicies: {
      safety_parent: {
        riskLevel: 'low',
        escalationPolicyId: 'none',
      },
      safety_child: {
        riskLevel: 'medium',
        escalationPolicyId: 'minor_default',
      },
    },
    operations: {
      managerMemberIds: ['parent-1'],
      laneRetention: {
        defaultDays: 30,
        byLaneId: {
          'child_private:child-1': 7,
        },
      },
    },
  };

  await writeFile(
    path.join(configDir, 'control-plane.json'),
    JSON.stringify(controlPlane, null, 2),
    'utf8',
  );
};

const seedScopeFileRegistry = async (rootDir: string, scopeId: string) => {
  await setScopeVectorStoreId({ rootDir, scopeId }, 'vs_1', 100);
  await upsertScopeFileRecord(
    { rootDir, scopeId },
    {
      telegramFileId: 'telegram-file-1',
      telegramFileUniqueId: 'telegram-unique-1',
      filename: 'report.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 123,
      openaiFileId: 'file_1',
      vectorStoreFileId: null,
      status: 'completed',
      lastError: null,
      uploadedBy: 'wags',
      uploadedAtMs: 100,
    },
    100,
  );
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

  it('includes semantic sync status in /status when provided', async () => {
    const store = await makeSessionStore();
    const handler = createStatusHandler({
      startedAtMs: 0,
      host: '127.0.0.1',
      port: 7777,
      version: '1.2.3',
      haloHome: buildHaloHomePaths('/halo'),
      sessionStore: store,
      semanticSyncStatusProvider: () => ({
        enabled: true,
        intervalMinutes: 15,
        activeScopeCount: 2,
        running: false,
        lastRunStartedAtMs: 123,
        lastRunFinishedAtMs: 124,
        lastSuccessAtMs: 124,
        totalRuns: 3,
        totalFailures: 1,
        lastError: {
          scopeId: 'telegram:dm:wags',
          message: 'boom',
          atMs: 122,
        },
      }),
    });

    const res = makeMockResponse();
    await handler({ method: 'GET', url: '/status' }, res);

    const payload = JSON.parse(res.body) as {
      semanticSync?: {
        enabled?: boolean;
        intervalMinutes?: number | null;
        totalRuns?: number;
      };
    };

    expect(payload.semanticSync?.enabled).toBe(true);
    expect(payload.semanticSync?.intervalMinutes).toBe(15);
    expect(payload.semanticSync?.totalRuns).toBe(3);
  });

  it('includes file retention status in /status when provided', async () => {
    const store = await makeSessionStore();
    const handler = createStatusHandler({
      startedAtMs: 0,
      host: '127.0.0.1',
      port: 7777,
      version: '1.2.3',
      haloHome: buildHaloHomePaths('/halo'),
      sessionStore: store,
      fileRetentionStatusProvider: () => ({
        enabled: true,
        intervalMinutes: 60,
        maxAgeDays: 30,
        deleteOpenAIFiles: false,
        maxFilesPerRun: 25,
        dryRun: false,
        keepRecentPerScope: 0,
        maxDeletesPerScopePerRun: 10,
        allowScopeIds: [],
        denyScopeIds: [],
        policyPreset: 'all',
        running: false,
        lastRunStartedAtMs: 100,
        lastRunFinishedAtMs: 101,
        lastSuccessAtMs: 101,
        totalRuns: 2,
        totalDeleted: 3,
        totalFailures: 1,
        lastError: {
          scopeId: 'telegram:dm:wags',
          fileRef: 'telegram-unique-1',
          message: 'boom',
          atMs: 99,
        },
        lastRunSummary: {
          scopeCount: 1,
          staleCount: 2,
          candidateCount: 2,
          attemptedCount: 2,
          deletedCount: 1,
          failedCount: 1,
          dryRun: false,
          skippedDryRunCount: 0,
          skippedInProgressCount: 0,
          protectedRecentCount: 0,
          deferredByRunCapCount: 0,
          deferredByScopeCapCount: 0,
          excludedByAllowCount: 0,
          excludedByDenyCount: 0,
          excludedByPresetCount: 0,
          excludedByUploaderCount: 0,
          excludedByTypeCount: 0,
          excludedByDateCount: 0,
          filters: {
            uploadedBy: [],
            extensions: [],
            mimePrefixes: [],
            uploadedAfterMs: null,
            uploadedBeforeMs: null,
          },
        },
      }),
    });

    const res = makeMockResponse();
    await handler({ method: 'GET', url: '/status' }, res);

    const payload = JSON.parse(res.body) as {
      fileRetention?: {
        enabled?: boolean;
        intervalMinutes?: number | null;
        totalDeleted?: number;
        lastRunSummary?: { candidateCount?: number };
      };
    };

    expect(payload.fileRetention?.enabled).toBe(true);
    expect(payload.fileRetention?.intervalMinutes).toBe(60);
    expect(payload.fileRetention?.totalDeleted).toBe(3);
    expect(payload.fileRetention?.lastRunSummary?.candidateCount).toBe(2);
  });

  it('triggers file retention run for /file-retention/run', async () => {
    const store = await makeSessionStore();
    const runFileRetentionNow = vi.fn().mockResolvedValue(undefined);

    const handler = createStatusHandler({
      startedAtMs: 0,
      host: '127.0.0.1',
      port: 7777,
      version: '1.2.3',
      haloHome: buildHaloHomePaths('/halo'),
      sessionStore: store,
      config: {
        fileMemory: {
          enabled: true,
          retention: {
            enabled: true,
            dryRun: false,
          },
        },
      },
      runFileRetentionNow,
      fileRetentionStatusProvider: () => ({
        enabled: true,
        intervalMinutes: 60,
        maxAgeDays: 30,
        deleteOpenAIFiles: false,
        maxFilesPerRun: 25,
        dryRun: false,
        keepRecentPerScope: 0,
        maxDeletesPerScopePerRun: 10,
        allowScopeIds: [],
        denyScopeIds: [],
        policyPreset: 'all',
        running: false,
        lastRunStartedAtMs: 100,
        lastRunFinishedAtMs: 101,
        lastSuccessAtMs: 101,
        totalRuns: 1,
        totalDeleted: 0,
        totalFailures: 0,
        lastError: null,
        lastRunSummary: {
          scopeCount: 1,
          staleCount: 1,
          candidateCount: 1,
          attemptedCount: 1,
          deletedCount: 1,
          failedCount: 0,
          dryRun: false,
          skippedDryRunCount: 0,
          skippedInProgressCount: 0,
          protectedRecentCount: 0,
          deferredByRunCapCount: 0,
          deferredByScopeCapCount: 0,
          excludedByAllowCount: 0,
          excludedByDenyCount: 0,
          excludedByPresetCount: 0,
          excludedByUploaderCount: 0,
          excludedByTypeCount: 0,
          excludedByDateCount: 0,
          filters: {
            uploadedBy: [],
            extensions: [],
            mimePrefixes: [],
            uploadedAfterMs: null,
            uploadedBeforeMs: null,
          },
        },
      }),
    });

    const res = makeMockResponse();
    await handler(
      {
        method: 'POST',
        url: '/file-retention/run?scopeId=telegram%3Adm%3Awags&dryRun=1',
        socket: { remoteAddress: '127.0.0.1' },
      },
      res,
    );

    expect(runFileRetentionNow).toHaveBeenCalledWith({
      scopeId: 'telegram:dm:wags',
      dryRun: true,
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      ok: true,
      requested: {
        scopeId: 'telegram:dm:wags',
        dryRun: true,
      },
    });
  });

  it('passes metadata filters to file retention manual runs', async () => {
    const store = await makeSessionStore();
    const runFileRetentionNow = vi.fn().mockResolvedValue(undefined);

    const handler = createStatusHandler({
      startedAtMs: 0,
      host: '127.0.0.1',
      port: 7777,
      version: '1.2.3',
      haloHome: buildHaloHomePaths('/halo'),
      sessionStore: store,
      config: {
        fileMemory: {
          enabled: true,
          retention: {
            enabled: true,
            dryRun: false,
          },
        },
      },
      runFileRetentionNow,
    });

    const res = makeMockResponse();
    await handler(
      {
        method: 'POST',
        url: '/file-retention/run?uploadedBy=wags,kid&extensions=.pdf,txt&mimePrefixes=application/pdf,text/&uploadedAfterMs=10&uploadedBeforeMs=20',
        socket: { remoteAddress: '127.0.0.1' },
      },
      res,
    );

    expect(runFileRetentionNow).toHaveBeenCalledWith({
      scopeId: undefined,
      dryRun: false,
      uploadedBy: ['wags', 'kid'],
      extensions: ['.pdf', 'txt'],
      mimePrefixes: ['application/pdf', 'text/'],
      uploadedAfterMs: 10,
      uploadedBeforeMs: 20,
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 500 when file retention run fails', async () => {
    const store = await makeSessionStore();
    const runFileRetentionNow = vi.fn().mockRejectedValue(new Error('boom'));

    const handler = createStatusHandler({
      startedAtMs: 0,
      host: '127.0.0.1',
      port: 7777,
      version: '1.2.3',
      haloHome: buildHaloHomePaths('/halo'),
      sessionStore: store,
      config: {
        fileMemory: {
          enabled: true,
          retention: {
            enabled: true,
          },
        },
      },
      runFileRetentionNow,
    });

    const res = makeMockResponse();
    await handler(
      {
        method: 'POST',
        url: '/file-retention/run',
        socket: { remoteAddress: '127.0.0.1' },
      },
      res,
    );

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toEqual({
      error: 'file_retention_failed',
      message: 'boom',
    });
  });

  it('rejects non-local file retention runs', async () => {
    const store = await makeSessionStore();
    const runFileRetentionNow = vi.fn().mockResolvedValue(undefined);

    const handler = createStatusHandler({
      startedAtMs: 0,
      host: '127.0.0.1',
      port: 7777,
      version: '1.2.3',
      haloHome: buildHaloHomePaths('/halo'),
      sessionStore: store,
      config: {
        fileMemory: {
          enabled: true,
          retention: {
            enabled: true,
          },
        },
      },
      runFileRetentionNow,
    });

    const res = makeMockResponse();
    await handler(
      {
        method: 'POST',
        url: '/file-retention/run',
        socket: { remoteAddress: '203.0.113.1' },
      },
      res,
    );

    expect(res.statusCode).toBe(403);
    expect(runFileRetentionNow).not.toHaveBeenCalled();
  });

  it('returns 409 when file retention is disabled for manual run endpoint', async () => {
    const store = await makeSessionStore();
    const runFileRetentionNow = vi.fn().mockResolvedValue(undefined);

    const handler = createStatusHandler({
      startedAtMs: 0,
      host: '127.0.0.1',
      port: 7777,
      version: '1.2.3',
      haloHome: buildHaloHomePaths('/halo'),
      sessionStore: store,
      config: {
        fileMemory: {
          enabled: true,
          retention: {
            enabled: false,
          },
        },
      },
      runFileRetentionNow,
    });

    const res = makeMockResponse();
    await handler(
      {
        method: 'POST',
        url: '/file-retention/run',
        socket: { remoteAddress: '127.0.0.1' },
      },
      res,
    );

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toEqual({ error: 'file_retention_disabled' });
    expect(runFileRetentionNow).not.toHaveBeenCalled();
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

  it('runs deterministic distillation for /sessions/:scopeId/distill', async () => {
    const haloHome = await mkdtemp(path.join(os.tmpdir(), 'halo-home-'));
    const store = await makeSessionStore(haloHome);

    const scopeId = 'telegram:dm:wags';
    const session = store.getOrCreate(scopeId);
    await session.addItems([
      userMessage('remember: I like black coffee'),
      userMessage('today I walked 10k steps'),
    ]);

    const handler = createStatusHandler({
      startedAtMs: 0,
      host: '127.0.0.1',
      port: 7777,
      version: null,
      haloHome: buildHaloHomePaths(haloHome),
      sessionStore: store,
      config: { features: { distillationEnabled: true } },
    });

    const res = makeMockResponse();
    await handler(
      {
        method: 'POST',
        url: `/sessions/${encodeURIComponent(scopeId)}/distill`,
      },
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');

    const payload = JSON.parse(res.body) as {
      ok: boolean;
      scopeId: string;
      durableFacts: number;
      temporalNotes: number;
    };
    expect(payload.ok).toBe(true);
    expect(payload.scopeId).toBe(scopeId);
    expect(payload.durableFacts).toBe(1);
    expect(payload.temporalNotes).toBe(1);
  });

  it('returns 409 when distillation is disabled for /sessions/:scopeId/distill', async () => {
    const haloHome = await mkdtemp(path.join(os.tmpdir(), 'halo-home-'));
    const store = await makeSessionStore(haloHome);

    const scopeId = 'telegram:dm:wags';
    store.getOrCreate(scopeId);

    const handler = createStatusHandler({
      startedAtMs: 0,
      host: '127.0.0.1',
      port: 7777,
      version: null,
      haloHome: buildHaloHomePaths(haloHome),
      sessionStore: store,
      config: { features: { distillationEnabled: false } },
    });

    const res = makeMockResponse();
    await handler(
      {
        method: 'POST',
        url: `/sessions/${encodeURIComponent(scopeId)}/distill`,
      },
      res,
    );

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toEqual({ error: 'distillation_disabled' });
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

  it('returns policy status for /policy/status', async () => {
    const haloHome = await mkdtemp(path.join(os.tmpdir(), 'halo-home-'));
    await writeFamilyConfig(haloHome);
    const store = await makeSessionStore(haloHome);

    const handler = createStatusHandler({
      startedAtMs: 0,
      host: '127.0.0.1',
      port: 7777,
      version: null,
      haloHome: buildHaloHomePaths(haloHome),
      sessionStore: store,
    });

    const res = makeMockResponse();
    await handler({ method: 'GET', url: '/policy/status' }, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');

    const payload = JSON.parse(res.body) as {
      scopes: Array<{
        scopeId: string;
        scopeType: string;
        allow: boolean;
        reason?: string;
        memberId?: string;
        role?: string;
        displayName?: string;
      }>;
    };

    expect(payload.scopes).toEqual([
      {
        scopeId: 'telegram:dm:parent-1',
        scopeType: 'dm',
        allow: true,
        memberId: 'parent-1',
        role: 'parent',
        displayName: 'Pat',
      },
      {
        scopeId: 'telegram:dm:child-1',
        scopeType: 'dm',
        allow: true,
        memberId: 'child-1',
        role: 'child',
        displayName: 'Kid',
      },
      {
        scopeId: 'telegram:dm:teen-1',
        scopeType: 'dm',
        allow: true,
        memberId: 'teen-1',
        role: 'child',
        displayName: 'Teen',
      },
      {
        scopeId: 'telegram:parents_group:999',
        scopeType: 'parents_group',
        allow: true,
        memberId: 'parent-1',
        role: 'parent',
        displayName: 'Pat',
      },
      {
        scopeId: 'telegram:parents_group:999',
        scopeType: 'parents_group',
        allow: false,
        reason: 'child_in_parents_group',
        memberId: 'child-1',
        role: 'child',
        displayName: 'Kid',
      },
      {
        scopeId: 'telegram:parents_group:999',
        scopeType: 'parents_group',
        allow: false,
        reason: 'child_in_parents_group',
        memberId: 'teen-1',
        role: 'child',
        displayName: 'Teen',
      },
    ]);
  });

  it('returns transcript tail for /transcripts/tail', async () => {
    const haloHome = await mkdtemp(path.join(os.tmpdir(), 'halo-home-'));
    const transcriptsDir = path.join(haloHome, 'transcripts');
    const scopeId = 'scope-1';
    const transcriptPath = path.join(transcriptsDir, `${hashSessionId(scopeId)}.jsonl`);
    const entries = [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'one' }] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'two' }] },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'three' }] },
    ];

    await mkdir(transcriptsDir, { recursive: true });
    await writeFile(
      transcriptPath,
      entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n',
      'utf8',
    );

    const store = await makeSessionStore(haloHome);
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
      {
        method: 'GET',
        url: `/transcripts/tail?scopeId=${encodeURIComponent(scopeId)}&lines=2`,
        socket: { remoteAddress: '127.0.0.1' },
      },
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(JSON.parse(res.body)).toEqual(entries.slice(-2));
  });

  it('rejects non-local requests for /transcripts/tail', async () => {
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
      {
        method: 'GET',
        url: '/transcripts/tail?scopeId=scope-1&lines=1',
        socket: { remoteAddress: '10.0.0.1' },
      },
      res,
    );

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: 'forbidden' });
  });

  it('allows parents to read a child transcript', async () => {
    const haloHome = await mkdtemp(path.join(os.tmpdir(), 'halo-home-'));
    await writeFamilyConfig(haloHome);
    const store = await makeSessionStore(haloHome);
    const session = store.getOrCreate('telegram:dm:child-1');

    await session.addItems([userMessage('hi there')]);

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
      {
        method: 'GET',
        url: '/sessions/telegram%3Adm%3Achild-1/transcript?role=parent',
      },
      res,
    );

    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body) as unknown[];
    expect(payload.length).toBe(1);
    expect(payload[0]).toMatchObject({ role: 'user' });
  });

  it('rejects transcript reads when requester is not a parent', async () => {
    const haloHome = await mkdtemp(path.join(os.tmpdir(), 'halo-home-'));
    await writeFamilyConfig(haloHome);
    const store = await makeSessionStore(haloHome);
    const session = store.getOrCreate('telegram:dm:child-1');

    await session.addItems([userMessage('hi there')]);

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
      {
        method: 'GET',
        url: '/sessions/telegram%3Adm%3Achild-1/transcript?role=child',
      },
      res,
    );

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: 'forbidden' });
  });

  it('allows parents to read teen transcript when opted in', async () => {
    const haloHome = await mkdtemp(path.join(os.tmpdir(), 'halo-home-'));
    await writeFamilyConfig(haloHome);
    const store = await makeSessionStore(haloHome);
    const session = store.getOrCreate('telegram:dm:teen-1');

    await session.addItems([userMessage('hi from teen')]);

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
      {
        method: 'GET',
        url: '/sessions/telegram%3Adm%3Ateen-1/transcript?role=parent',
      },
      res,
    );

    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body) as unknown[];
    expect(payload.length).toBe(1);
    expect(payload[0]).toMatchObject({ role: 'user' });
  });

  it('rejects teen transcript when not opted in', async () => {
    const haloHome = await mkdtemp(path.join(os.tmpdir(), 'halo-home-'));
    const configDir = path.join(haloHome, 'config');
    await mkdir(configDir, { recursive: true });
    const payload = {
      schemaVersion: 1,
      familyId: 'test-family',
      members: [
        {
          memberId: 'parent-1',
          displayName: 'Pat',
          role: 'parent',
          telegramUserIds: [111],
        },
        {
          memberId: 'teen-2',
          displayName: 'Teen',
          role: 'child',
          ageGroup: 'teen',
          parentalVisibility: false,
          telegramUserIds: [444],
        },
      ],
      parentsGroup: { telegramChatId: 999 },
    };
    await writeFile(path.join(configDir, 'family.json'), JSON.stringify(payload), 'utf8');

    const store = await makeSessionStore(haloHome);
    const session = store.getOrCreate('telegram:dm:teen-2');
    await session.addItems([userMessage('hi from teen')]);

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
      {
        method: 'GET',
        url: '/sessions/telegram%3Adm%3Ateen-2/transcript?role=parent',
      },
      res,
    );

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: 'forbidden' });
  });

  it('lists file-memory files for /sessions/:scopeId/files', async () => {
    const haloHome = await mkdtemp(path.join(os.tmpdir(), 'halo-home-'));
    const scopeId = 'telegram:dm:wags';
    await seedScopeFileRegistry(haloHome, scopeId);
    const store = await makeSessionStore(haloHome);

    const handler = createStatusHandler({
      startedAtMs: 0,
      host: '127.0.0.1',
      port: 7777,
      version: null,
      haloHome: buildHaloHomePaths(haloHome),
      sessionStore: store,
      config: {
        fileMemory: {
          enabled: true,
        },
      },
    });

    const res = makeMockResponse();
    await handler(
      {
        method: 'GET',
        url: `/sessions/${encodeURIComponent(scopeId)}/files`,
      },
      res,
    );

    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body) as {
      scopeId: string;
      vectorStoreId: string | null;
      files: Array<{ telegramFileUniqueId: string }>;
    };
    expect(payload.scopeId).toBe(scopeId);
    expect(payload.vectorStoreId).toBe('vs_1');
    expect(payload.files).toHaveLength(1);
    expect(payload.files[0]?.telegramFileUniqueId).toBe('telegram-unique-1');
  });

  it('deletes a file-memory file for /sessions/:scopeId/files/:fileRef/delete', async () => {
    const haloHome = await mkdtemp(path.join(os.tmpdir(), 'halo-home-'));
    const scopeId = 'telegram:dm:wags';
    await seedScopeFileRegistry(haloHome, scopeId);
    const store = await makeSessionStore(haloHome);

    const handler = createStatusHandler({
      startedAtMs: 0,
      host: '127.0.0.1',
      port: 7777,
      version: null,
      haloHome: buildHaloHomePaths(haloHome),
      sessionStore: store,
      config: {
        fileMemory: {
          enabled: true,
        },
      },
    });

    const res = makeMockResponse();
    await handler(
      {
        method: 'POST',
        url: `/sessions/${encodeURIComponent(scopeId)}/files/telegram-unique-1/delete?deleteOpenAIFile=0`,
        socket: { remoteAddress: '127.0.0.1' },
      },
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      ok: true,
      deleted: true,
    });

    const registry = await readScopeFileRegistry({ rootDir: haloHome, scopeId });
    expect(registry?.files).toHaveLength(0);
  });

  it('purges file-memory files for /sessions/:scopeId/files/purge', async () => {
    const haloHome = await mkdtemp(path.join(os.tmpdir(), 'halo-home-'));
    const scopeId = 'telegram:dm:wags';
    await seedScopeFileRegistry(haloHome, scopeId);
    await upsertScopeFileRecord(
      { rootDir: haloHome, scopeId },
      {
        telegramFileId: 'telegram-file-2',
        telegramFileUniqueId: 'telegram-unique-2',
        filename: 'notes.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 123,
        openaiFileId: 'file_2',
        vectorStoreFileId: null,
        status: 'completed',
        lastError: null,
        uploadedBy: 'wags',
        uploadedAtMs: 101,
      },
      101,
    );

    const store = await makeSessionStore(haloHome);
    const handler = createStatusHandler({
      startedAtMs: 0,
      host: '127.0.0.1',
      port: 7777,
      version: null,
      haloHome: buildHaloHomePaths(haloHome),
      sessionStore: store,
      config: {
        fileMemory: {
          enabled: true,
        },
      },
    });

    const res = makeMockResponse();
    await handler(
      {
        method: 'POST',
        url: `/sessions/${encodeURIComponent(scopeId)}/files/purge?deleteOpenAIFiles=0`,
        socket: { remoteAddress: '127.0.0.1' },
      },
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      ok: true,
      removedCount: 2,
      remainingCount: 0,
    });

    const registry = await readScopeFileRegistry({ rootDir: haloHome, scopeId });
    expect(registry?.files).toHaveLength(0);
  });

  it('returns 409 when file memory is disabled for file endpoints', async () => {
    const haloHome = await mkdtemp(path.join(os.tmpdir(), 'halo-home-'));
    const scopeId = 'telegram:dm:wags';
    await seedScopeFileRegistry(haloHome, scopeId);
    const store = await makeSessionStore(haloHome);

    const handler = createStatusHandler({
      startedAtMs: 0,
      host: '127.0.0.1',
      port: 7777,
      version: null,
      haloHome: buildHaloHomePaths(haloHome),
      sessionStore: store,
      config: {
        fileMemory: {
          enabled: false,
        },
      },
    });

    const res = makeMockResponse();
    await handler(
      {
        method: 'GET',
        url: `/sessions/${encodeURIComponent(scopeId)}/files`,
      },
      res,
    );

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toEqual({ error: 'file_memory_disabled' });
  });

  it('exports lane memory for configured parent managers', async () => {
    const haloHome = await mkdtemp(path.join(os.tmpdir(), 'halo-home-'));
    await writeControlPlaneFamilyConfig(haloHome);
    const laneId = 'child_private:child-1';

    await appendLaneLongTermFacts({ rootDir: haloHome, laneId }, ['Kid solved hard puzzles']);
    await appendLaneDailyNotesUnique(
      { rootDir: haloHome, laneId },
      ['Math practice streak'],
      new Date('2026-02-18T10:00:00.000Z'),
    );

    const store = await makeSessionStore(haloHome);
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
      {
        method: 'GET',
        url: `/memory/lanes/${encodeURIComponent(laneId)}/export?memberId=parent-1`,
        socket: { remoteAddress: '127.0.0.1' },
      },
      res,
    );

    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body) as {
      laneId: string;
      longTerm: string;
      dailyFiles: Array<{ date: string }>;
    };
    expect(payload.laneId).toBe(laneId);
    expect(payload.longTerm).toContain('Kid solved hard puzzles');
    expect(payload.dailyFiles).toHaveLength(1);
    expect(payload.dailyFiles[0]?.date).toBe('2026-02-18');
  });

  it('blocks lane export for parent members without operations manager access', async () => {
    const haloHome = await mkdtemp(path.join(os.tmpdir(), 'halo-home-'));
    await writeControlPlaneFamilyConfig(haloHome);
    const laneId = 'child_private:child-1';

    const store = await makeSessionStore(haloHome);
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
      {
        method: 'GET',
        url: `/memory/lanes/${encodeURIComponent(laneId)}/export?memberId=parent-2`,
        socket: { remoteAddress: '127.0.0.1' },
      },
      res,
    );

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({
      error: 'operations_forbidden',
      reason: 'parent_not_manager',
    });
  });

  it('blocks lane export for non-loopback requests', async () => {
    const haloHome = await mkdtemp(path.join(os.tmpdir(), 'halo-home-'));
    await writeControlPlaneFamilyConfig(haloHome);
    const laneId = 'child_private:child-1';

    const store = await makeSessionStore(haloHome);
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
      {
        method: 'GET',
        url: `/memory/lanes/${encodeURIComponent(laneId)}/export?memberId=parent-1`,
        socket: { remoteAddress: '10.0.0.1' },
      },
      res,
    );

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: 'forbidden' });
  });

  it('returns 405 with Allow header for unsupported lane memory methods', async () => {
    const haloHome = await mkdtemp(path.join(os.tmpdir(), 'halo-home-'));
    await writeControlPlaneFamilyConfig(haloHome);
    const laneId = 'child_private:child-1';

    const store = await makeSessionStore(haloHome);
    const handler = createStatusHandler({
      startedAtMs: 0,
      host: '127.0.0.1',
      port: 7777,
      version: null,
      haloHome: buildHaloHomePaths(haloHome),
      sessionStore: store,
    });

    const exportRes = makeMockResponse();
    await handler(
      {
        method: 'POST',
        url: `/memory/lanes/${encodeURIComponent(laneId)}/export?memberId=parent-1`,
        socket: { remoteAddress: '127.0.0.1' },
      },
      exportRes,
    );

    expect(exportRes.statusCode).toBe(405);
    expect(exportRes.headers.allow).toBe('GET');
    expect(JSON.parse(exportRes.body)).toEqual({
      error: 'method_not_allowed',
      allowed: ['GET'],
    });

    const deleteRes = makeMockResponse();
    await handler(
      {
        method: 'GET',
        url: `/memory/lanes/${encodeURIComponent(laneId)}/delete?memberId=parent-1`,
        socket: { remoteAddress: '127.0.0.1' },
      },
      deleteRes,
    );

    expect(deleteRes.statusCode).toBe(405);
    expect(deleteRes.headers.allow).toBe('POST');
    expect(JSON.parse(deleteRes.body)).toEqual({
      error: 'method_not_allowed',
      allowed: ['POST'],
    });
  });

  it('runs lane retention with per-lane policy defaults', async () => {
    const haloHome = await mkdtemp(path.join(os.tmpdir(), 'halo-home-'));
    await writeControlPlaneFamilyConfig(haloHome);
    const laneId = 'child_private:child-1';

    await appendLaneDailyNotesUnique(
      { rootDir: haloHome, laneId },
      ['Old entry'],
      new Date('2026-02-01T10:00:00.000Z'),
    );
    await appendLaneDailyNotesUnique(
      { rootDir: haloHome, laneId },
      ['Recent entry'],
      new Date('2026-02-16T10:00:00.000Z'),
    );

    const store = await makeSessionStore(haloHome);
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
      {
        method: 'POST',
        url: `/memory/lanes/${encodeURIComponent(laneId)}/retention/run?memberId=parent-1&now=2026-02-18T10:00:00.000Z`,
        socket: { remoteAddress: '127.0.0.1' },
      },
      res,
    );

    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body) as {
      retentionDays: number;
      deletedFiles: string[];
      keptFiles: string[];
    };
    expect(payload.retentionDays).toBe(7);
    expect(payload.deletedFiles).toEqual(['2026-02-01.md']);
    expect(payload.keptFiles).toContain('2026-02-16.md');
  });

  it('deletes lane memory to recoverable trash for parent managers', async () => {
    const haloHome = await mkdtemp(path.join(os.tmpdir(), 'halo-home-'));
    await writeControlPlaneFamilyConfig(haloHome);
    const laneId = 'child_private:child-1';

    await appendLaneLongTermFacts({ rootDir: haloHome, laneId }, ['Delete me']);

    const store = await makeSessionStore(haloHome);
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
      {
        method: 'POST',
        url: `/memory/lanes/${encodeURIComponent(laneId)}/delete?memberId=parent-1`,
        socket: { remoteAddress: '127.0.0.1' },
      },
      res,
    );

    expect(res.statusCode).toBe(200);

    const payload = JSON.parse(res.body) as {
      deleted: boolean;
      trashPath: string;
    };
    expect(payload.deleted).toBe(true);

    const longTermPath = getLaneLongTermPath({ rootDir: haloHome, laneId });
    await expect(stat(longTermPath)).rejects.toThrow();
    await expect(stat(payload.trashPath)).resolves.toBeTruthy();
  });

  it('creates runtime backups for configured operations managers', async () => {
    const haloHome = await mkdtemp(path.join(os.tmpdir(), 'halo-home-'));
    await writeControlPlaneFamilyConfig(haloHome);

    await mkdir(path.join(haloHome, 'config'), { recursive: true });
    await writeFile(path.join(haloHome, 'config', 'family.json'), '{"version":1}\n', 'utf8');

    const store = await makeSessionStore(haloHome);
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
      {
        method: 'POST',
        url: '/operations/backup/create?memberId=parent-1&backupId=daily-1',
        socket: { remoteAddress: '127.0.0.1' },
      },
      res,
    );

    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body) as {
      backupId: string;
      manifestPath: string;
      includedPaths: string[];
    };

    expect(payload.backupId).toBe('daily-1');
    expect(payload.includedPaths).toContain('config');
    await expect(stat(payload.manifestPath)).resolves.toBeTruthy();
  });

  it('restores runtime backups for configured operations managers', async () => {
    const haloHome = await mkdtemp(path.join(os.tmpdir(), 'halo-home-'));
    await writeControlPlaneFamilyConfig(haloHome);

    await mkdir(path.join(haloHome, 'config'), { recursive: true });
    const familyConfigPath = path.join(haloHome, 'config', 'family.json');
    await writeFile(familyConfigPath, '{"version":1}\n', 'utf8');

    const store = await makeSessionStore(haloHome);
    const handler = createStatusHandler({
      startedAtMs: 0,
      host: '127.0.0.1',
      port: 7777,
      version: null,
      haloHome: buildHaloHomePaths(haloHome),
      sessionStore: store,
    });

    const backupRes = makeMockResponse();
    await handler(
      {
        method: 'POST',
        url: '/operations/backup/create?memberId=parent-1&backupId=daily-2',
        socket: { remoteAddress: '127.0.0.1' },
      },
      backupRes,
    );

    expect(backupRes.statusCode).toBe(200);

    await writeFile(familyConfigPath, '{"version":2}\n', 'utf8');

    const restoreRes = makeMockResponse();
    await handler(
      {
        method: 'POST',
        url: '/operations/backup/restore?memberId=parent-1&backupId=daily-2',
        socket: { remoteAddress: '127.0.0.1' },
      },
      restoreRes,
    );

    expect(restoreRes.statusCode).toBe(200);
    const payload = JSON.parse(restoreRes.body) as {
      backupId: string;
      restoredPaths: string[];
    };
    expect(payload.backupId).toBe('daily-2');
    expect(payload.restoredPaths).toContain('config');
    expect(await readFile(familyConfigPath, 'utf8')).toBe('{"version":1}\n');
  });

  it('blocks backup operations for non-manager parents', async () => {
    const haloHome = await mkdtemp(path.join(os.tmpdir(), 'halo-home-'));
    await writeControlPlaneFamilyConfig(haloHome);

    const store = await makeSessionStore(haloHome);
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
      {
        method: 'POST',
        url: '/operations/backup/create?memberId=parent-2',
        socket: { remoteAddress: '127.0.0.1' },
      },
      res,
    );

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({
      error: 'operations_forbidden',
      reason: 'parent_not_manager',
    });
  });

  it('reports backup restore failures with an actionable incident payload', async () => {
    const haloHome = await mkdtemp(path.join(os.tmpdir(), 'halo-home-'));
    await writeControlPlaneFamilyConfig(haloHome);

    const store = await makeSessionStore(haloHome);
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
      {
        method: 'POST',
        url: '/operations/backup/restore?memberId=parent-1&backupId=missing-backup',
        socket: { remoteAddress: '127.0.0.1' },
      },
      res,
    );

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toMatchObject({
      error: 'backup_operation_failed',
      message: expect.stringContaining('missing-backup'),
    });

    const incidentPath = path.join(haloHome, 'logs', 'incidents.jsonl');
    const incidentLog = await readFile(incidentPath, 'utf8');
    expect(incidentLog).toContain('backup_manifest_missing');
  });

  it('purges session data for /sessions/:scopeId/purge', async () => {
    const haloHome = await mkdtemp(path.join(os.tmpdir(), 'halo-home-'));
    const store = await makeSessionStore(haloHome);
    const session = store.getOrCreate('scope-1');

    await session.addItems([
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'hello' }],
      },
    ]);

    const sessionPath = path.join(haloHome, 'sessions', `${hashSessionId('scope-1')}.jsonl`);
    const transcriptPath = path.join(haloHome, 'transcripts', `${hashSessionId('scope-1')}.jsonl`);

    expect(await stat(sessionPath)).toBeTruthy();
    expect(await stat(transcriptPath)).toBeTruthy();

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
      {
        method: 'POST',
        url: '/sessions/scope-1/purge?confirm=scope-1',
        socket: { remoteAddress: '127.0.0.1' },
      },
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true, scopeId: 'scope-1' });
    await expect(stat(sessionPath)).rejects.toThrow();
    await expect(stat(transcriptPath)).rejects.toThrow();
  });

  it('requires confirmation for /sessions/:scopeId/purge', async () => {
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
      {
        method: 'POST',
        url: '/sessions/scope-1/purge',
        socket: { remoteAddress: '127.0.0.1' },
      },
      res,
    );

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'confirm_required' });
  });
});
