import { describe, expect, it, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { indexTelegramDocument } from './openaiFileIndexer.js';
import {
  readScopeFileRegistry,
  setScopeVectorStoreId,
  upsertScopeFileRecord,
} from './scopeFileRegistry.js';

describe('openaiFileIndexer', () => {
  it('returns success for already-indexed Telegram files without re-uploading', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'openai-file-indexer-'));
    const scopeId = 'telegram:dm:wags';

    await setScopeVectorStoreId({ rootDir, scopeId }, 'vs_existing', 100);
    await upsertScopeFileRecord(
      { rootDir, scopeId },
      {
        telegramFileId: 'telegram-file-1',
        telegramFileUniqueId: 'telegram-unique-1',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        openaiFileId: 'file_existing',
        vectorStoreFileId: 'vsfile_existing',
        status: 'completed',
        lastError: null,
        uploadedBy: 'wags',
        uploadedAtMs: 100,
      },
      100,
    );

    const client = {
      vectorStores: {
        create: vi.fn().mockResolvedValue({ id: 'vs_1' }),
        files: {
          createAndPoll: vi.fn().mockResolvedValue({
            id: 'vsfile_1',
            status: 'completed',
            last_error: null,
          }),
        },
      },
      files: {
        create: vi.fn().mockResolvedValue({ id: 'file_1' }),
      },
    };

    const result = await indexTelegramDocument(
      {
        rootDir,
        scopeId,
        uploadedBy: 'wags',
        telegramFileId: 'telegram-file-1',
        telegramFileUniqueId: 'telegram-unique-1',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        bytes: new Uint8Array([1, 2, 3]),
        maxFilesPerScope: 200,
        pollIntervalMs: 1500,
      },
      {
        client,
        toFile: vi.fn().mockResolvedValue({}),
      },
    );

    expect(result).toEqual({
      ok: true,
      filename: 'report.pdf',
    });
    expect(client.files.create).not.toHaveBeenCalled();
    expect(client.vectorStores.files.createAndPoll).not.toHaveBeenCalled();
  });

  it('creates a vector store and indexes a document', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'openai-file-indexer-'));
    const scopeId = 'telegram:dm:wags';

    const client = {
      vectorStores: {
        create: vi.fn().mockResolvedValue({ id: 'vs_1' }),
        files: {
          createAndPoll: vi.fn().mockResolvedValue({
            id: 'vsfile_1',
            status: 'completed',
            last_error: null,
          }),
        },
      },
      files: {
        create: vi.fn().mockResolvedValue({ id: 'file_1' }),
      },
    };

    const result = await indexTelegramDocument(
      {
        rootDir,
        scopeId,
        uploadedBy: 'wags',
        telegramFileId: 'telegram-file-1',
        telegramFileUniqueId: 'telegram-unique-1',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        bytes: new Uint8Array([1, 2, 3]),
        maxFilesPerScope: 200,
        pollIntervalMs: 1500,
      },
      {
        client,
        toFile: vi.fn().mockResolvedValue({}),
      },
    );

    expect(result).toEqual({
      ok: true,
      filename: 'report.pdf',
    });
    expect(client.vectorStores.create).toHaveBeenCalledTimes(1);

    const registry = await readScopeFileRegistry({ rootDir, scopeId });
    expect(registry?.vectorStoreId).toBe('vs_1');
    expect(registry?.files).toHaveLength(1);
    expect(registry?.files[0]).toMatchObject({
      telegramFileUniqueId: 'telegram-unique-1',
      openaiFileId: 'file_1',
      vectorStoreFileId: 'vsfile_1',
      status: 'completed',
    });
  });

  it('reuses an existing vector store for the scope', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'openai-file-indexer-'));
    const scopeId = 'telegram:dm:wags';

    await setScopeVectorStoreId({ rootDir, scopeId }, 'vs_existing', 100);

    const client = {
      vectorStores: {
        create: vi.fn().mockResolvedValue({ id: 'vs_new' }),
        files: {
          createAndPoll: vi.fn().mockResolvedValue({
            id: 'vsfile_1',
            status: 'completed',
            last_error: null,
          }),
        },
      },
      files: {
        create: vi.fn().mockResolvedValue({ id: 'file_1' }),
      },
    };

    await indexTelegramDocument(
      {
        rootDir,
        scopeId,
        uploadedBy: 'wags',
        telegramFileId: 'telegram-file-1',
        telegramFileUniqueId: 'telegram-unique-1',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        bytes: new Uint8Array([1, 2, 3]),
        maxFilesPerScope: 200,
        pollIntervalMs: 1500,
      },
      {
        client,
        toFile: vi.fn().mockResolvedValue({}),
      },
    );

    expect(client.vectorStores.create).not.toHaveBeenCalled();
    expect(client.vectorStores.files.createAndPoll).toHaveBeenCalledWith(
      'vs_existing',
      { file_id: 'file_1' },
      { pollIntervalMs: 1500 },
    );
  });

  it('retries transient OpenAI indexing failures and eventually succeeds', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'openai-file-indexer-'));
    const scopeId = 'telegram:dm:wags';

    const client = {
      vectorStores: {
        create: vi.fn().mockResolvedValue({ id: 'vs_1' }),
        files: {
          createAndPoll: vi
            .fn()
            .mockRejectedValueOnce({ status: 429, message: 'rate limited' })
            .mockResolvedValueOnce({
              id: 'vsfile_1',
              status: 'completed',
              last_error: null,
            }),
        },
      },
      files: {
        create: vi.fn().mockResolvedValue({ id: 'file_1' }),
      },
    };

    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await indexTelegramDocument(
      {
        rootDir,
        scopeId,
        uploadedBy: 'wags',
        telegramFileId: 'telegram-file-1',
        telegramFileUniqueId: 'telegram-unique-1',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        bytes: new Uint8Array([1, 2, 3]),
        maxFilesPerScope: 200,
        pollIntervalMs: 1500,
      },
      {
        client,
        toFile: vi.fn().mockResolvedValue({}),
        sleep,
      },
    );

    expect(result).toEqual({ ok: true, filename: 'report.pdf' });
    expect(client.vectorStores.files.createAndPoll).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('serializes concurrent uploads for the same scope', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'openai-file-indexer-'));
    const scopeId = 'telegram:dm:wags';

    const client = {
      vectorStores: {
        create: vi.fn().mockResolvedValue({ id: 'vs_1' }),
        files: {
          createAndPoll: vi.fn().mockImplementation(
            async () =>
              await new Promise((resolve) =>
                setTimeout(
                  () =>
                    resolve({
                      id: 'vsfile_1',
                      status: 'completed',
                      last_error: null,
                    }),
                  25,
                ),
              ),
          ),
        },
      },
      files: {
        create: vi.fn().mockResolvedValue({ id: 'file_1' }),
      },
    };

    const [first, second] = await Promise.all([
      indexTelegramDocument(
        {
          rootDir,
          scopeId,
          uploadedBy: 'wags',
          telegramFileId: 'telegram-file-1',
          telegramFileUniqueId: 'telegram-unique-1',
          filename: 'report.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          bytes: new Uint8Array([1, 2, 3]),
          maxFilesPerScope: 200,
          pollIntervalMs: 1500,
        },
        {
          client,
          toFile: vi.fn().mockResolvedValue({}),
        },
      ),
      indexTelegramDocument(
        {
          rootDir,
          scopeId,
          uploadedBy: 'wags',
          telegramFileId: 'telegram-file-2',
          telegramFileUniqueId: 'telegram-unique-2',
          filename: 'notes.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          bytes: new Uint8Array([4, 5, 6]),
          maxFilesPerScope: 200,
          pollIntervalMs: 1500,
        },
        {
          client,
          toFile: vi.fn().mockResolvedValue({}),
        },
      ),
    ]);

    expect(first).toEqual({ ok: true, filename: 'report.pdf' });
    expect(second).toEqual({ ok: true, filename: 'notes.pdf' });
    expect(client.vectorStores.create).toHaveBeenCalledTimes(1);

    const registry = await readScopeFileRegistry({ rootDir, scopeId });
    expect(registry?.files).toHaveLength(2);
    expect(registry?.vectorStoreId).toBe('vs_1');
  });

  it('persists a failed record with null vectorStoreFileId when indexing throws', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'openai-file-indexer-'));
    const scopeId = 'telegram:dm:wags';

    const client = {
      vectorStores: {
        create: vi.fn().mockResolvedValue({ id: 'vs_1' }),
        files: {
          createAndPoll: vi.fn().mockRejectedValue(new Error('indexing failed')),
        },
      },
      files: {
        create: vi.fn().mockResolvedValue({ id: 'file_1' }),
      },
    };

    const result = await indexTelegramDocument(
      {
        rootDir,
        scopeId,
        uploadedBy: 'wags',
        telegramFileId: 'telegram-file-1',
        telegramFileUniqueId: 'telegram-unique-1',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        bytes: new Uint8Array([1, 2, 3]),
        maxFilesPerScope: 200,
        pollIntervalMs: 1500,
      },
      {
        client,
        toFile: vi.fn().mockResolvedValue({}),
      },
    );

    expect(result).toEqual({ ok: false, message: 'indexing failed' });

    const registry = await readScopeFileRegistry({ rootDir, scopeId });
    expect(registry?.files).toHaveLength(1);
    expect(registry?.files[0]).toMatchObject({
      telegramFileUniqueId: 'telegram-unique-1',
      openaiFileId: 'file_1',
      vectorStoreFileId: null,
      status: 'failed',
      lastError: 'indexing failed',
    });
  });

  it('marks indexing as failed when completed status misses vectorStoreFileId', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'openai-file-indexer-'));
    const scopeId = 'telegram:dm:wags';

    const client = {
      vectorStores: {
        create: vi.fn().mockResolvedValue({ id: 'vs_1' }),
        files: {
          createAndPoll: vi.fn().mockResolvedValue({
            id: '',
            status: 'completed',
            last_error: null,
          }),
        },
      },
      files: {
        create: vi.fn().mockResolvedValue({ id: 'file_1' }),
      },
    };

    const result = await indexTelegramDocument(
      {
        rootDir,
        scopeId,
        uploadedBy: 'wags',
        telegramFileId: 'telegram-file-1',
        telegramFileUniqueId: 'telegram-unique-1',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        bytes: new Uint8Array([1, 2, 3]),
        maxFilesPerScope: 200,
        pollIntervalMs: 1500,
      },
      {
        client,
        toFile: vi.fn().mockResolvedValue({}),
      },
    );

    expect(result).toEqual({
      ok: false,
      message: 'OpenAI indexing completed without a vector-store file id.',
    });

    const registry = await readScopeFileRegistry({ rootDir, scopeId });
    expect(registry?.files).toHaveLength(1);
    expect(registry?.files[0]).toMatchObject({
      vectorStoreFileId: null,
      status: 'failed',
      lastError: 'OpenAI indexing completed without a vector-store file id.',
    });
  });

  it('fails when max files per scope is reached', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'openai-file-indexer-'));
    const scopeId = 'telegram:dm:wags';

    await setScopeVectorStoreId({ rootDir, scopeId }, 'vs_existing', 100);
    await upsertScopeFileRecord(
      { rootDir, scopeId },
      {
        telegramFileId: 'telegram-file-0',
        telegramFileUniqueId: 'telegram-unique-0',
        filename: 'existing.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 120,
        openaiFileId: 'file_0',
        vectorStoreFileId: 'vsfile_0',
        status: 'completed',
        lastError: null,
        uploadedBy: 'wags',
        uploadedAtMs: 10,
      },
      100,
    );

    const client = {
      vectorStores: {
        create: vi.fn().mockResolvedValue({ id: 'vs_new' }),
        files: {
          createAndPoll: vi.fn().mockResolvedValue({
            id: 'vsfile_1',
            status: 'completed',
            last_error: null,
          }),
        },
      },
      files: {
        create: vi.fn().mockResolvedValue({ id: 'file_1' }),
      },
    };

    const result = await indexTelegramDocument(
      {
        rootDir,
        scopeId,
        uploadedBy: 'wags',
        telegramFileId: 'telegram-file-1',
        telegramFileUniqueId: 'telegram-unique-1',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        bytes: new Uint8Array([1, 2, 3]),
        maxFilesPerScope: 1,
        pollIntervalMs: 1500,
      },
      {
        client,
        toFile: vi.fn().mockResolvedValue({}),
      },
    );

    expect(result).toEqual({
      ok: false,
      message: 'File memory limit reached for this chat.',
    });
    expect(client.files.create).not.toHaveBeenCalled();
    expect(client.vectorStores.files.createAndPoll).not.toHaveBeenCalled();
  });
});
