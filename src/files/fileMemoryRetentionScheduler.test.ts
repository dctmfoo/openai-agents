import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createFileMemoryRetentionScheduler } from './fileMemoryRetentionScheduler.js';
import { setScopeVectorStoreId, upsertScopeFileRecord } from './scopeFileRegistry.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('fileMemoryRetentionScheduler', () => {
  it('is disabled when file memory retention is disabled', async () => {
    const deleted: string[] = [];

    const scheduler = createFileMemoryRetentionScheduler({
      rootDir: '/halo',
      fileMemoryConfig: {
        enabled: true,
        retention: {
          enabled: false,
        },
      },
      listScopeRegistries: async () => [
        {
          scopeId: 'telegram:dm:wags',
          vectorStoreId: 'vs_1',
          createdAtMs: 10,
          updatedAtMs: 10,
          files: [
            {
              telegramFileId: 'telegram-file-1',
              telegramFileUniqueId: 'telegram-unique-1',
              filename: 'old.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 123,
              openaiFileId: 'file_1',
              vectorStoreFileId: 'vsfile_1',
              status: 'completed',
              lastError: null,
              uploadedBy: 'wags',
              uploadedAtMs: 1,
            },
          ],
        },
      ],
      deleteScopedFile: async ({ fileRef }) => {
        deleted.push(fileRef);
        return { ok: true, deleted: true, removed: null };
      },
    });

    expect(scheduler.isEnabled()).toBe(false);
    await scheduler.runNow();

    expect(deleted).toEqual([]);
  });

  it('supports dry-run mode and reports retained candidates without deleting', async () => {
    const nowMs = 90 * 24 * 60 * 60 * 1000;
    const dayMs = 24 * 60 * 60 * 1000;

    const deleted: Array<{ scopeId: string; fileRef: string; deleteOpenAIFile: boolean }> = [];

    const scheduler = createFileMemoryRetentionScheduler({
      rootDir: '/halo',
      nowMs: () => nowMs,
      fileMemoryConfig: {
        enabled: true,
        retention: {
          enabled: true,
          maxAgeDays: 30,
          runIntervalMinutes: 60,
          deleteOpenAIFiles: true,
          maxFilesPerRun: 2,
          dryRun: true,
          keepRecentPerScope: 0,
        },
      },
      listScopeRegistries: async () => [
        {
          scopeId: 'telegram:dm:a',
          vectorStoreId: 'vs_a',
          createdAtMs: 1,
          updatedAtMs: 1,
          files: [
            {
              telegramFileId: 'telegram-file-a-oldest',
              telegramFileUniqueId: 'telegram-unique-a-oldest',
              filename: 'a-oldest.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 123,
              openaiFileId: 'file_a_oldest',
              vectorStoreFileId: 'vsfile_a_oldest',
              status: 'completed',
              lastError: null,
              uploadedBy: 'wags',
              uploadedAtMs: nowMs - 70 * dayMs,
            },
          ],
        },
      ],
      deleteScopedFile: async ({ scopeId, fileRef, deleteOpenAIFile }) => {
        deleted.push({ scopeId, fileRef, deleteOpenAIFile });
        return { ok: true, deleted: true, removed: null };
      },
    });

    await scheduler.runNow();

    expect(deleted).toEqual([]);

    const status = scheduler.getStatus();
    expect(status.enabled).toBe(true);
    expect(status.totalRuns).toBe(1);
    expect(status.totalDeleted).toBe(0);
    expect(status.totalFailures).toBe(0);
    expect(status.lastRunSummary?.dryRun).toBe(true);
    expect(status.lastRunSummary?.candidateCount).toBe(1);
    expect(status.lastRunSummary?.attemptedCount).toBe(0);
    expect(status.lastRunSummary?.skippedDryRunCount).toBe(1);
  });

  it('applies in-progress/recent/scope cap guardrails before deleting', async () => {
    const nowMs = 90 * 24 * 60 * 60 * 1000;
    const dayMs = 24 * 60 * 60 * 1000;

    const deleted: Array<{ scopeId: string; fileRef: string; deleteOpenAIFile: boolean }> = [];

    const scheduler = createFileMemoryRetentionScheduler({
      rootDir: '/halo',
      nowMs: () => nowMs,
      fileMemoryConfig: {
        enabled: true,
        retention: {
          enabled: true,
          maxAgeDays: 30,
          runIntervalMinutes: 60,
          deleteOpenAIFiles: true,
          maxFilesPerRun: 10,
          keepRecentPerScope: 1,
          maxDeletesPerScopePerRun: 1,
        },
      },
      listScopeRegistries: async () => [
        {
          scopeId: 'telegram:dm:a',
          vectorStoreId: 'vs_a',
          createdAtMs: 1,
          updatedAtMs: 1,
          files: [
            {
              telegramFileId: 'telegram-file-a-oldest',
              telegramFileUniqueId: 'telegram-unique-a-oldest',
              filename: 'a-oldest.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 123,
              openaiFileId: 'file_a_oldest',
              vectorStoreFileId: 'vsfile_a_oldest',
              status: 'completed',
              lastError: null,
              uploadedBy: 'wags',
              uploadedAtMs: nowMs - 80 * dayMs,
            },
            {
              telegramFileId: 'telegram-file-a-protected',
              telegramFileUniqueId: 'telegram-unique-a-protected',
              filename: 'a-protected.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 123,
              openaiFileId: 'file_a_protected',
              vectorStoreFileId: 'vsfile_a_protected',
              status: 'completed',
              lastError: null,
              uploadedBy: 'wags',
              uploadedAtMs: nowMs - 40 * dayMs,
            },
            {
              telegramFileId: 'telegram-file-a-in-progress',
              telegramFileUniqueId: 'telegram-unique-a-in-progress',
              filename: 'a-in-progress.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 123,
              openaiFileId: 'file_a_in_progress',
              vectorStoreFileId: 'vsfile_a_in_progress',
              status: 'in_progress',
              lastError: null,
              uploadedBy: 'wags',
              uploadedAtMs: nowMs - 90 * dayMs,
            },
          ],
        },
        {
          scopeId: 'telegram:dm:b',
          vectorStoreId: 'vs_b',
          createdAtMs: 1,
          updatedAtMs: 1,
          files: [
            {
              telegramFileId: 'telegram-file-b-oldest',
              telegramFileUniqueId: 'telegram-unique-b-oldest',
              filename: 'b-oldest.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 123,
              openaiFileId: 'file_b_oldest',
              vectorStoreFileId: 'vsfile_b_oldest',
              status: 'completed',
              lastError: null,
              uploadedBy: 'wags',
              uploadedAtMs: nowMs - 85 * dayMs,
            },
            {
              telegramFileId: 'telegram-file-b-middle',
              telegramFileUniqueId: 'telegram-unique-b-middle',
              filename: 'b-middle.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 123,
              openaiFileId: 'file_b_middle',
              vectorStoreFileId: 'vsfile_b_middle',
              status: 'failed',
              lastError: 'failed',
              uploadedBy: 'wags',
              uploadedAtMs: nowMs - 75 * dayMs,
            },
            {
              telegramFileId: 'telegram-file-b-deferred',
              telegramFileUniqueId: 'telegram-unique-b-deferred',
              filename: 'b-deferred.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 123,
              openaiFileId: 'file_b_deferred',
              vectorStoreFileId: 'vsfile_b_deferred',
              status: 'failed',
              lastError: 'failed',
              uploadedBy: 'wags',
              uploadedAtMs: nowMs - 70 * dayMs,
            },
          ],
        },
      ],
      deleteScopedFile: async ({ scopeId, fileRef, deleteOpenAIFile }) => {
        deleted.push({ scopeId, fileRef, deleteOpenAIFile });
        return { ok: true, deleted: true, removed: null };
      },
    });

    await scheduler.runNow();

    expect(deleted).toEqual([
      {
        scopeId: 'telegram:dm:b',
        fileRef: 'telegram-unique-b-oldest',
        deleteOpenAIFile: true,
      },
      {
        scopeId: 'telegram:dm:a',
        fileRef: 'telegram-unique-a-oldest',
        deleteOpenAIFile: true,
      },
    ]);

    const status = scheduler.getStatus();
    expect(status.enabled).toBe(true);
    expect(status.totalRuns).toBe(1);
    expect(status.totalDeleted).toBe(2);
    expect(status.totalFailures).toBe(0);
    expect(status.lastRunSummary?.dryRun).toBe(false);
    expect(status.lastRunSummary?.skippedInProgressCount).toBe(1);
    expect(status.lastRunSummary?.protectedRecentCount).toBe(2);
    expect(status.lastRunSummary?.deferredByScopeCapCount).toBe(1);
  });

  it('supports per-run overrides for scope and dryRun', async () => {
    const nowMs = 90 * 24 * 60 * 60 * 1000;
    const dayMs = 24 * 60 * 60 * 1000;

    const deleted: Array<{ scopeId: string; fileRef: string; deleteOpenAIFile: boolean }> = [];

    const scheduler = createFileMemoryRetentionScheduler({
      rootDir: '/halo',
      nowMs: () => nowMs,
      fileMemoryConfig: {
        enabled: true,
        retention: {
          enabled: true,
          maxAgeDays: 30,
          runIntervalMinutes: 60,
          deleteOpenAIFiles: true,
          maxFilesPerRun: 10,
          dryRun: false,
          keepRecentPerScope: 0,
        },
      },
      listScopeRegistries: async () => [
        {
          scopeId: 'telegram:dm:a',
          vectorStoreId: 'vs_a',
          createdAtMs: 1,
          updatedAtMs: 1,
          files: [
            {
              telegramFileId: 'telegram-file-a-oldest',
              telegramFileUniqueId: 'telegram-unique-a-oldest',
              filename: 'a-oldest.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 123,
              openaiFileId: 'file_a_oldest',
              vectorStoreFileId: 'vsfile_a_oldest',
              status: 'completed',
              lastError: null,
              uploadedBy: 'wags',
              uploadedAtMs: nowMs - 80 * dayMs,
            },
          ],
        },
        {
          scopeId: 'telegram:dm:b',
          vectorStoreId: 'vs_b',
          createdAtMs: 1,
          updatedAtMs: 1,
          files: [
            {
              telegramFileId: 'telegram-file-b-oldest',
              telegramFileUniqueId: 'telegram-unique-b-oldest',
              filename: 'b-oldest.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 123,
              openaiFileId: 'file_b_oldest',
              vectorStoreFileId: 'vsfile_b_oldest',
              status: 'completed',
              lastError: null,
              uploadedBy: 'wags',
              uploadedAtMs: nowMs - 85 * dayMs,
            },
          ],
        },
      ],
      deleteScopedFile: async ({ scopeId, fileRef, deleteOpenAIFile }) => {
        deleted.push({ scopeId, fileRef, deleteOpenAIFile });
        return { ok: true, deleted: true, removed: null };
      },
    });

    await scheduler.runNow({ scopeId: 'telegram:dm:b', dryRun: true });

    expect(deleted).toEqual([]);
    expect(scheduler.getStatus().lastRunSummary?.dryRun).toBe(true);
    expect(scheduler.getStatus().lastRunSummary?.scopeCount).toBe(1);
    expect(scheduler.getStatus().lastRunSummary?.candidateCount).toBe(1);

    await scheduler.runNow({ scopeId: 'telegram:dm:b', dryRun: false });

    expect(deleted).toEqual([
      {
        scopeId: 'telegram:dm:b',
        fileRef: 'telegram-unique-b-oldest',
        deleteOpenAIFile: true,
      },
    ]);
  });

  it('applies scope allow/deny filters with deny precedence', async () => {
    const nowMs = 90 * 24 * 60 * 60 * 1000;
    const dayMs = 24 * 60 * 60 * 1000;

    const deleted: Array<{ scopeId: string; fileRef: string; deleteOpenAIFile: boolean }> = [];

    const scheduler = createFileMemoryRetentionScheduler({
      rootDir: '/halo',
      nowMs: () => nowMs,
      fileMemoryConfig: {
        enabled: true,
        retention: {
          enabled: true,
          maxAgeDays: 30,
          runIntervalMinutes: 60,
          deleteOpenAIFiles: true,
          maxFilesPerRun: 10,
          keepRecentPerScope: 0,
          allowScopeIds: ['telegram:dm:a', 'telegram:dm:b'],
          denyScopeIds: ['telegram:dm:b'],
        },
      },
      listScopeRegistries: async () => [
        {
          scopeId: 'telegram:dm:a',
          vectorStoreId: 'vs_a',
          createdAtMs: 1,
          updatedAtMs: 1,
          files: [
            {
              telegramFileId: 'telegram-file-a-oldest',
              telegramFileUniqueId: 'telegram-unique-a-oldest',
              filename: 'a-oldest.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 123,
              openaiFileId: 'file_a_oldest',
              vectorStoreFileId: 'vsfile_a_oldest',
              status: 'completed',
              lastError: null,
              uploadedBy: 'wags',
              uploadedAtMs: nowMs - 80 * dayMs,
            },
          ],
        },
        {
          scopeId: 'telegram:dm:b',
          vectorStoreId: 'vs_b',
          createdAtMs: 1,
          updatedAtMs: 1,
          files: [
            {
              telegramFileId: 'telegram-file-b-oldest',
              telegramFileUniqueId: 'telegram-unique-b-oldest',
              filename: 'b-oldest.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 123,
              openaiFileId: 'file_b_oldest',
              vectorStoreFileId: 'vsfile_b_oldest',
              status: 'completed',
              lastError: null,
              uploadedBy: 'wags',
              uploadedAtMs: nowMs - 81 * dayMs,
            },
          ],
        },
        {
          scopeId: 'telegram:dm:c',
          vectorStoreId: 'vs_c',
          createdAtMs: 1,
          updatedAtMs: 1,
          files: [
            {
              telegramFileId: 'telegram-file-c-oldest',
              telegramFileUniqueId: 'telegram-unique-c-oldest',
              filename: 'c-oldest.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 123,
              openaiFileId: 'file_c_oldest',
              vectorStoreFileId: 'vsfile_c_oldest',
              status: 'completed',
              lastError: null,
              uploadedBy: 'wags',
              uploadedAtMs: nowMs - 82 * dayMs,
            },
          ],
        },
      ],
      deleteScopedFile: async ({ scopeId, fileRef, deleteOpenAIFile }) => {
        deleted.push({ scopeId, fileRef, deleteOpenAIFile });
        return { ok: true, deleted: true, removed: null };
      },
    });

    await scheduler.runNow();

    expect(deleted).toEqual([
      {
        scopeId: 'telegram:dm:a',
        fileRef: 'telegram-unique-a-oldest',
        deleteOpenAIFile: true,
      },
    ]);

    const summary = scheduler.getStatus().lastRunSummary;
    expect(summary?.excludedByAllowCount).toBe(1);
    expect(summary?.excludedByDenyCount).toBe(1);
  });

  it('applies policy preset filters using family roles', async () => {
    const nowMs = 90 * 24 * 60 * 60 * 1000;
    const dayMs = 24 * 60 * 60 * 1000;

    const deleted: Array<{ scopeId: string; fileRef: string; deleteOpenAIFile: boolean }> = [];

    const scheduler = createFileMemoryRetentionScheduler({
      rootDir: '/halo',
      nowMs: () => nowMs,
      memberRolesById: {
        wags: 'parent',
        kid: 'child',
      },
      fileMemoryConfig: {
        enabled: true,
        retention: {
          enabled: true,
          maxAgeDays: 30,
          runIntervalMinutes: 60,
          deleteOpenAIFiles: false,
          maxFilesPerRun: 10,
          keepRecentPerScope: 0,
          policyPreset: 'parents_only',
        },
      },
      listScopeRegistries: async () => [
        {
          scopeId: 'telegram:dm:wags',
          vectorStoreId: 'vs_parent',
          createdAtMs: 1,
          updatedAtMs: 1,
          files: [
            {
              telegramFileId: 'telegram-file-parent',
              telegramFileUniqueId: 'telegram-unique-parent',
              filename: 'parent.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 123,
              openaiFileId: 'file_parent',
              vectorStoreFileId: 'vsfile_parent',
              status: 'completed',
              lastError: null,
              uploadedBy: 'wags',
              uploadedAtMs: nowMs - 80 * dayMs,
            },
          ],
        },
        {
          scopeId: 'telegram:dm:kid',
          vectorStoreId: 'vs_child',
          createdAtMs: 1,
          updatedAtMs: 1,
          files: [
            {
              telegramFileId: 'telegram-file-child',
              telegramFileUniqueId: 'telegram-unique-child',
              filename: 'child.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 123,
              openaiFileId: 'file_child',
              vectorStoreFileId: 'vsfile_child',
              status: 'completed',
              lastError: null,
              uploadedBy: 'kid',
              uploadedAtMs: nowMs - 80 * dayMs,
            },
          ],
        },
        {
          scopeId: 'telegram:parents_group:999',
          vectorStoreId: 'vs_group',
          createdAtMs: 1,
          updatedAtMs: 1,
          files: [
            {
              telegramFileId: 'telegram-file-group',
              telegramFileUniqueId: 'telegram-unique-group',
              filename: 'group.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 123,
              openaiFileId: 'file_group',
              vectorStoreFileId: 'vsfile_group',
              status: 'completed',
              lastError: null,
              uploadedBy: 'wags',
              uploadedAtMs: nowMs - 80 * dayMs,
            },
          ],
        },
      ],
      deleteScopedFile: async ({ scopeId, fileRef, deleteOpenAIFile }) => {
        deleted.push({ scopeId, fileRef, deleteOpenAIFile });
        return { ok: true, deleted: true, removed: null };
      },
    });

    await scheduler.runNow();

    expect(deleted).toEqual([
      {
        scopeId: 'telegram:dm:wags',
        fileRef: 'telegram-unique-parent',
        deleteOpenAIFile: false,
      },
      {
        scopeId: 'telegram:parents_group:999',
        fileRef: 'telegram-unique-group',
        deleteOpenAIFile: false,
      },
    ]);

    const summary = scheduler.getStatus().lastRunSummary;
    expect(summary?.excludedByPresetCount).toBe(1);
  });

  it('applies run-time metadata filters (uploader/date/type) and reports skip counts', async () => {
    const nowMs = 90 * 24 * 60 * 60 * 1000;
    const dayMs = 24 * 60 * 60 * 1000;

    const deleted: Array<{ scopeId: string; fileRef: string; deleteOpenAIFile: boolean }> = [];

    const scheduler = createFileMemoryRetentionScheduler({
      rootDir: '/halo',
      nowMs: () => nowMs,
      fileMemoryConfig: {
        enabled: true,
        retention: {
          enabled: true,
          maxAgeDays: 30,
          runIntervalMinutes: 60,
          deleteOpenAIFiles: true,
          maxFilesPerRun: 10,
          keepRecentPerScope: 0,
        },
      },
      listScopeRegistries: async () => [
        {
          scopeId: 'telegram:dm:wags',
          vectorStoreId: 'vs_wags',
          createdAtMs: 1,
          updatedAtMs: 1,
          files: [
            {
              telegramFileId: 'telegram-file-keep',
              telegramFileUniqueId: 'telegram-unique-keep',
              filename: 'keep.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 123,
              openaiFileId: 'file_keep',
              vectorStoreFileId: 'vsfile_keep',
              status: 'completed',
              lastError: null,
              uploadedBy: 'wags',
              uploadedAtMs: nowMs - 80 * dayMs,
            },
            {
              telegramFileId: 'telegram-file-type-ext',
              telegramFileUniqueId: 'telegram-unique-type-ext',
              filename: 'notes.txt',
              mimeType: 'text/plain',
              sizeBytes: 123,
              openaiFileId: 'file_type_ext',
              vectorStoreFileId: 'vsfile_type_ext',
              status: 'completed',
              lastError: null,
              uploadedBy: 'wags',
              uploadedAtMs: nowMs - 81 * dayMs,
            },
            {
              telegramFileId: 'telegram-file-type-mime',
              telegramFileUniqueId: 'telegram-unique-type-mime',
              filename: 'notes.pdf',
              mimeType: 'application/octet-stream',
              sizeBytes: 123,
              openaiFileId: 'file_type_mime',
              vectorStoreFileId: 'vsfile_type_mime',
              status: 'completed',
              lastError: null,
              uploadedBy: 'wags',
              uploadedAtMs: nowMs - 82 * dayMs,
            },
            {
              telegramFileId: 'telegram-file-uploader',
              telegramFileUniqueId: 'telegram-unique-uploader',
              filename: 'kid.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 123,
              openaiFileId: 'file_uploader',
              vectorStoreFileId: 'vsfile_uploader',
              status: 'completed',
              lastError: null,
              uploadedBy: 'kid',
              uploadedAtMs: nowMs - 83 * dayMs,
            },
            {
              telegramFileId: 'telegram-file-date',
              telegramFileUniqueId: 'telegram-unique-date',
              filename: 'old.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 123,
              openaiFileId: 'file_date',
              vectorStoreFileId: 'vsfile_date',
              status: 'completed',
              lastError: null,
              uploadedBy: 'wags',
              uploadedAtMs: nowMs - 90 * dayMs,
            },
          ],
        },
      ],
      deleteScopedFile: async ({ scopeId, fileRef, deleteOpenAIFile }) => {
        deleted.push({ scopeId, fileRef, deleteOpenAIFile });
        return { ok: true, deleted: true, removed: null };
      },
    });

    await scheduler.runNow({
      uploadedBy: ['wags'],
      extensions: ['pdf'],
      mimePrefixes: ['application/pdf'],
      uploadedAfterMs: nowMs - 85 * dayMs,
    });

    expect(deleted).toEqual([
      {
        scopeId: 'telegram:dm:wags',
        fileRef: 'telegram-unique-keep',
        deleteOpenAIFile: true,
      },
    ]);

    const summary = scheduler.getStatus().lastRunSummary;
    expect(summary?.excludedByTypeCount).toBe(2);
    expect(summary?.excludedByUploaderCount).toBe(1);
    expect(summary?.excludedByDateCount).toBe(1);
    expect(summary?.filters).toEqual({
      uploadedBy: ['wags'],
      extensions: ['pdf'],
      mimePrefixes: ['application/pdf'],
      uploadedAfterMs: nowMs - 85 * dayMs,
      uploadedBeforeMs: null,
    });
  });

  it('exclude_children preset excludes child scopes but keeps unknown DMs', async () => {
    const nowMs = 90 * 24 * 60 * 60 * 1000;
    const dayMs = 24 * 60 * 60 * 1000;

    const deleted: Array<{ scopeId: string; fileRef: string; deleteOpenAIFile: boolean }> = [];

    const scheduler = createFileMemoryRetentionScheduler({
      rootDir: '/halo',
      nowMs: () => nowMs,
      memberRolesById: {
        kid: 'child',
      },
      fileMemoryConfig: {
        enabled: true,
        retention: {
          enabled: true,
          maxAgeDays: 30,
          runIntervalMinutes: 60,
          deleteOpenAIFiles: false,
          maxFilesPerRun: 10,
          keepRecentPerScope: 0,
          policyPreset: 'exclude_children',
        },
      },
      listScopeRegistries: async () => [
        {
          scopeId: 'telegram:dm:kid',
          vectorStoreId: 'vs_child',
          createdAtMs: 1,
          updatedAtMs: 1,
          files: [
            {
              telegramFileId: 'telegram-file-child',
              telegramFileUniqueId: 'telegram-unique-child',
              filename: 'child.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 123,
              openaiFileId: 'file_child',
              vectorStoreFileId: 'vsfile_child',
              status: 'completed',
              lastError: null,
              uploadedBy: 'kid',
              uploadedAtMs: nowMs - 80 * dayMs,
            },
          ],
        },
        {
          scopeId: 'telegram:dm:unknown',
          vectorStoreId: 'vs_unknown',
          createdAtMs: 1,
          updatedAtMs: 1,
          files: [
            {
              telegramFileId: 'telegram-file-unknown',
              telegramFileUniqueId: 'telegram-unique-unknown',
              filename: 'unknown.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 123,
              openaiFileId: 'file_unknown',
              vectorStoreFileId: 'vsfile_unknown',
              status: 'completed',
              lastError: null,
              uploadedBy: 'unknown',
              uploadedAtMs: nowMs - 80 * dayMs,
            },
          ],
        },
      ],
      deleteScopedFile: async ({ scopeId, fileRef, deleteOpenAIFile }) => {
        deleted.push({ scopeId, fileRef, deleteOpenAIFile });
        return { ok: true, deleted: true, removed: null };
      },
    });

    await scheduler.runNow();

    expect(deleted).toEqual([
      {
        scopeId: 'telegram:dm:unknown',
        fileRef: 'telegram-unique-unknown',
        deleteOpenAIFile: false,
      },
    ]);

    const summary = scheduler.getStatus().lastRunSummary;
    expect(summary?.excludedByPresetCount).toBe(1);
  });

  it('retains failed records with null OpenAI/vector-store ids from disk registries', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'file-memory-retention-'));
    const scopeId = 'telegram:dm:wags';
    const nowMs = 90 * 24 * 60 * 60 * 1000;
    const dayMs = 24 * 60 * 60 * 1000;

    await setScopeVectorStoreId({ rootDir, scopeId }, 'vs_1', 100);
    await upsertScopeFileRecord(
      { rootDir, scopeId },
      {
        telegramFileId: 'telegram-file-1',
        telegramFileUniqueId: 'telegram-unique-1',
        filename: 'failed.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 123,
        openaiFileId: 'file_1',
        vectorStoreFileId: null,
        status: 'failed',
        lastError: 'index failed',
        uploadedBy: 'wags',
        uploadedAtMs: nowMs - 80 * dayMs,
      },
      100,
    );

    const deleted: Array<{ scopeId: string; fileRef: string; deleteOpenAIFile: boolean }> = [];

    const scheduler = createFileMemoryRetentionScheduler({
      rootDir,
      nowMs: () => nowMs,
      fileMemoryConfig: {
        enabled: true,
        retention: {
          enabled: true,
          maxAgeDays: 30,
          runIntervalMinutes: 60,
          deleteOpenAIFiles: true,
          maxFilesPerRun: 10,
          keepRecentPerScope: 0,
        },
      },
      deleteScopedFile: async ({ scopeId, fileRef, deleteOpenAIFile }) => {
        deleted.push({ scopeId, fileRef, deleteOpenAIFile });
        return { ok: true, deleted: true, removed: null };
      },
    });

    await scheduler.runNow();

    expect(deleted).toEqual([
      {
        scopeId,
        fileRef: 'telegram-unique-1',
        deleteOpenAIFile: true,
      },
    ]);
  });

  it('queues run options requested while another retention run is in-flight', async () => {
    const nowMs = 90 * 24 * 60 * 60 * 1000;
    const dayMs = 24 * 60 * 60 * 1000;

    let releaseFirstDelete!: () => void;
    const firstDeleteBlocked = new Promise<void>((resolve) => {
      releaseFirstDelete = () => resolve();
    });

    const deleted: Array<{ scopeId: string; fileRef: string; deleteOpenAIFile: boolean }> = [];

    const scheduler = createFileMemoryRetentionScheduler({
      rootDir: '/halo',
      nowMs: () => nowMs,
      fileMemoryConfig: {
        enabled: true,
        retention: {
          enabled: true,
          maxAgeDays: 30,
          runIntervalMinutes: 60,
          deleteOpenAIFiles: true,
          maxFilesPerRun: 10,
          keepRecentPerScope: 0,
        },
      },
      listScopeRegistries: async () => [
        {
          scopeId: 'telegram:dm:a',
          vectorStoreId: 'vs_a',
          createdAtMs: 1,
          updatedAtMs: 1,
          files: [
            {
              telegramFileId: 'telegram-file-a',
              telegramFileUniqueId: 'telegram-unique-a',
              filename: 'a.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 123,
              openaiFileId: 'file_a',
              vectorStoreFileId: 'vsfile_a',
              status: 'completed',
              lastError: null,
              uploadedBy: 'wags',
              uploadedAtMs: nowMs - 80 * dayMs,
            },
          ],
        },
        {
          scopeId: 'telegram:dm:b',
          vectorStoreId: 'vs_b',
          createdAtMs: 1,
          updatedAtMs: 1,
          files: [
            {
              telegramFileId: 'telegram-file-b',
              telegramFileUniqueId: 'telegram-unique-b',
              filename: 'b.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 123,
              openaiFileId: 'file_b',
              vectorStoreFileId: 'vsfile_b',
              status: 'completed',
              lastError: null,
              uploadedBy: 'wags',
              uploadedAtMs: nowMs - 81 * dayMs,
            },
          ],
        },
      ],
      deleteScopedFile: async ({ scopeId, fileRef, deleteOpenAIFile }) => {
        deleted.push({ scopeId, fileRef, deleteOpenAIFile });

        if (scopeId === 'telegram:dm:a') {
          await firstDeleteBlocked;
        }

        return { ok: true, deleted: true, removed: null };
      },
    });

    const firstRun = scheduler.runNow({ scopeId: 'telegram:dm:a', dryRun: false });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const secondRun = scheduler.runNow({ scopeId: 'telegram:dm:b', dryRun: true });

    expect(deleted).toEqual([
      {
        scopeId: 'telegram:dm:a',
        fileRef: 'telegram-unique-a',
        deleteOpenAIFile: true,
      },
    ]);

    releaseFirstDelete();

    await firstRun;
    await secondRun;

    expect(deleted).toEqual([
      {
        scopeId: 'telegram:dm:a',
        fileRef: 'telegram-unique-a',
        deleteOpenAIFile: true,
      },
    ]);

    const summary = scheduler.getStatus().lastRunSummary;
    expect(summary?.dryRun).toBe(true);
    expect(summary?.scopeCount).toBe(1);
    expect(summary?.candidateCount).toBe(1);
  });

  it('runs on interval when started', async () => {
    vi.useFakeTimers();

    const runLog: string[] = [];

    const scheduler = createFileMemoryRetentionScheduler({
      rootDir: '/halo',
      fileMemoryConfig: {
        enabled: true,
        retention: {
          enabled: true,
          maxAgeDays: 30,
          runIntervalMinutes: 1,
          deleteOpenAIFiles: false,
          maxFilesPerRun: 10,
          keepRecentPerScope: 0,
        },
      },
      listScopeRegistries: async () => [
        {
          scopeId: 'telegram:dm:wags',
          vectorStoreId: 'vs_1',
          createdAtMs: 1,
          updatedAtMs: 1,
          files: [
            {
              telegramFileId: 'telegram-file-1',
              telegramFileUniqueId: 'telegram-unique-1',
              filename: 'old.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 123,
              openaiFileId: 'file_1',
              vectorStoreFileId: 'vsfile_1',
              status: 'completed',
              lastError: null,
              uploadedBy: 'wags',
              uploadedAtMs: 0,
            },
          ],
        },
      ],
      deleteScopedFile: async ({ fileRef }) => {
        runLog.push(fileRef);
        return { ok: true, deleted: true, removed: null };
      },
      nowMs: () => 90 * 24 * 60 * 60 * 1000,
    });

    scheduler.start();
    await Promise.resolve();

    expect(runLog).toEqual(['telegram-unique-1']);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(runLog).toEqual(['telegram-unique-1', 'telegram-unique-1']);

    scheduler.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runLog).toEqual(['telegram-unique-1', 'telegram-unique-1']);
  });
});
