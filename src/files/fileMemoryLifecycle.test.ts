import { describe, expect, it, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  deleteScopeUploadedFile,
  listScopeUploadedFiles,
  purgeScopeUploadedFiles,
} from './fileMemoryLifecycle.js';
import {
  readScopeFileRegistry,
  setScopeVectorStoreId,
  upsertScopeFileRecord,
} from './scopeFileRegistry.js';

const seedScopeWithOneFile = async (rootDir: string, scopeId: string) => {
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
      vectorStoreFileId: 'vsfile_1',
      status: 'completed',
      lastError: null,
      uploadedBy: 'wags',
      uploadedAtMs: 100,
    },
    100,
  );
};

describe('fileMemoryLifecycle', () => {
  it('lists uploaded files for a scope', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'file-memory-lifecycle-'));
    const scopeId = 'telegram:dm:wags';

    await seedScopeWithOneFile(rootDir, scopeId);

    const result = await listScopeUploadedFiles({ rootDir, scopeId });

    expect(result.scopeId).toBe(scopeId);
    expect(result.vectorStoreId).toBe('vs_1');
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.telegramFileUniqueId).toBe('telegram-unique-1');
  });

  it('deletes a single scope file and updates registry', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'file-memory-lifecycle-'));
    const scopeId = 'telegram:dm:wags';

    await seedScopeWithOneFile(rootDir, scopeId);

    const client = {
      vectorStores: {
        files: {
          delete: vi.fn().mockResolvedValue({ id: 'vsfile_1', deleted: true }),
        },
      },
      files: {
        delete: vi.fn().mockResolvedValue({ id: 'file_1', deleted: true }),
      },
    };

    const result = await deleteScopeUploadedFile(
      {
        rootDir,
        scopeId,
        fileRef: 'telegram-unique-1',
        deleteOpenAIFile: true,
      },
      { client },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deleted).toBe(true);
      expect(result.removed?.telegramFileUniqueId).toBe('telegram-unique-1');
    }

    expect(client.vectorStores.files.delete).toHaveBeenCalledWith('vsfile_1', {
      vector_store_id: 'vs_1',
    });
    expect(client.files.delete).toHaveBeenCalledWith('file_1');

    const registry = await readScopeFileRegistry({ rootDir, scopeId });
    expect(registry?.files).toHaveLength(0);
  });

  it('purges files and retains failed deletions for retry', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'file-memory-lifecycle-'));
    const scopeId = 'telegram:dm:wags';

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
        vectorStoreFileId: 'vsfile_1',
        status: 'completed',
        lastError: null,
        uploadedBy: 'wags',
        uploadedAtMs: 100,
      },
      100,
    );
    await upsertScopeFileRecord(
      { rootDir, scopeId },
      {
        telegramFileId: 'telegram-file-2',
        telegramFileUniqueId: 'telegram-unique-2',
        filename: 'notes.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 123,
        openaiFileId: 'file_2',
        vectorStoreFileId: 'vsfile_2',
        status: 'completed',
        lastError: null,
        uploadedBy: 'wags',
        uploadedAtMs: 101,
      },
      101,
    );

    const client = {
      vectorStores: {
        files: {
          delete: vi
            .fn()
            .mockResolvedValueOnce({ id: 'vsfile_1', deleted: true })
            .mockRejectedValueOnce(new Error('boom')),
        },
      },
      files: {
        delete: vi.fn().mockResolvedValue({ id: 'file_1', deleted: true }),
      },
    };

    const result = await purgeScopeUploadedFiles(
      {
        rootDir,
        scopeId,
        deleteOpenAIFiles: false,
      },
      { client },
    );

    expect(result.ok).toBe(false);
    expect(result.removedCount).toBe(1);
    expect(result.remainingCount).toBe(1);
    expect(result.errors).toHaveLength(1);

    const registry = await readScopeFileRegistry({ rootDir, scopeId });
    expect(registry?.files).toHaveLength(1);
    expect(registry?.files[0]?.telegramFileUniqueId).toBe('telegram-unique-2');
  });
});
