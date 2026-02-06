import { describe, expect, it, vi, afterEach } from 'vitest';

import { createSemanticSyncScheduler } from './semanticSyncScheduler.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('semanticSyncScheduler', () => {
  it('is disabled when semantic memory is disabled', async () => {
    const syncedScopes: string[] = [];

    const scheduler = createSemanticSyncScheduler({
      rootDir: '/halo',
      sessionStore: {
        listScopeIds: () => ['telegram:dm:wags'],
      },
      semanticConfig: {
        enabled: false,
      },
      createSemanticMemory: (scopeId) => ({
        sync: async () => {
          syncedScopes.push(scopeId);
        },
      }),
    });

    expect(scheduler.isEnabled()).toBe(false);
    await scheduler.runNow();

    expect(syncedScopes).toEqual([]);
  });

  it('syncs every active scope when run', async () => {
    const syncedScopes: string[] = [];

    const scheduler = createSemanticSyncScheduler({
      rootDir: '/halo',
      sessionStore: {
        listScopeIds: () => ['telegram:dm:b', 'telegram:dm:a'],
      },
      semanticConfig: {
        enabled: true,
        syncIntervalMinutes: 5,
      },
      createSemanticMemory: (scopeId) => ({
        sync: async () => {
          syncedScopes.push(scopeId);
        },
      }),
    });

    await scheduler.runNow();

    expect(syncedScopes).toEqual(['telegram:dm:a', 'telegram:dm:b']);

    const status = scheduler.getStatus();
    expect(status.enabled).toBe(true);
    expect(status.intervalMinutes).toBe(5);
    expect(status.activeScopeCount).toBe(2);
    expect(status.totalRuns).toBe(1);
    expect(status.totalFailures).toBe(0);
    expect(status.lastSuccessAtMs).toBeTypeOf('number');
  });

  it('serializes overlapping runs', async () => {
    const starts: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const scheduler = createSemanticSyncScheduler({
      rootDir: '/halo',
      sessionStore: {
        listScopeIds: () => ['telegram:dm:wags'],
      },
      semanticConfig: {
        enabled: true,
      },
      createSemanticMemory: () => ({
        sync: async () => {
          starts.push('sync');
          await gate;
        },
      }),
    });

    const first = scheduler.runNow();
    const second = scheduler.runNow();

    expect(starts).toEqual(['sync']);

    release();

    await Promise.all([first, second]);
    expect(starts).toEqual(['sync']);
  });

  it('runs on an interval when started', async () => {
    vi.useFakeTimers();

    const syncedScopes: string[] = [];

    const scheduler = createSemanticSyncScheduler({
      rootDir: '/halo',
      sessionStore: {
        listScopeIds: () => ['telegram:dm:wags'],
      },
      semanticConfig: {
        enabled: true,
        syncIntervalMinutes: 1,
      },
      createSemanticMemory: () => ({
        sync: async () => {
          syncedScopes.push('tick');
        },
      }),
    });

    scheduler.start();
    await Promise.resolve();

    expect(syncedScopes).toEqual(['tick']);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(syncedScopes).toEqual(['tick', 'tick']);

    scheduler.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(syncedScopes).toEqual(['tick', 'tick']);
  });
});
