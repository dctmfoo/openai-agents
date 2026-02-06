import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  getScopeVectorStoreId,
  readScopeFileRegistry,
  replaceScopeFileRecords,
  setScopeVectorStoreId,
  upsertScopeFileRecord,
} from './scopeFileRegistry.js';

describe('scopeFileRegistry', () => {
  it('returns null vector store id when registry is missing', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'scope-file-registry-'));

    const vectorStoreId = await getScopeVectorStoreId({
      rootDir,
      scopeId: 'telegram:dm:wags',
    });

    expect(vectorStoreId).toBeNull();
  });

  it('creates and updates registry entries per scope', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'scope-file-registry-'));
    const scopeId = 'telegram:dm:wags';

    await upsertScopeFileRecord(
      { rootDir, scopeId },
      {
        telegramFileId: 'telegram-file-1',
        telegramFileUniqueId: 'telegram-unique-1',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1234,
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
        telegramFileId: 'telegram-file-1',
        telegramFileUniqueId: 'telegram-unique-1',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1234,
        openaiFileId: 'file_1',
        vectorStoreFileId: 'vsfile_1',
        status: 'failed',
        lastError: 'bad file',
        uploadedBy: 'wags',
        uploadedAtMs: 100,
      },
      200,
    );

    const registry = await readScopeFileRegistry({ rootDir, scopeId });
    expect(registry).not.toBeNull();
    expect(registry?.scopeId).toBe(scopeId);
    expect(registry?.files).toHaveLength(1);
    expect(registry?.files[0]?.status).toBe('failed');
    expect(registry?.files[0]?.lastError).toBe('bad file');
    expect(registry?.updatedAtMs).toBe(200);

    await setScopeVectorStoreId({ rootDir, scopeId }, 'vs_123', 300);

    const vectorStoreId = await getScopeVectorStoreId({ rootDir, scopeId });
    expect(vectorStoreId).toBe('vs_123');

    const replaced = await replaceScopeFileRecords(
      { rootDir, scopeId },
      [
        {
          telegramFileId: 'telegram-file-2',
          telegramFileUniqueId: 'telegram-unique-2',
          filename: 'new.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 42,
          openaiFileId: 'file_2',
          vectorStoreFileId: 'vsfile_2',
          status: 'completed',
          lastError: null,
          uploadedBy: 'wags',
          uploadedAtMs: 400,
        },
      ],
      400,
    );
    expect(replaced.files).toHaveLength(1);
    expect(replaced.files[0]?.telegramFileUniqueId).toBe('telegram-unique-2');

    const persisted = await readScopeFileRegistry({ rootDir, scopeId });
    expect(persisted?.vectorStoreId).toBe('vs_123');
    expect(persisted?.files).toHaveLength(1);
    expect(persisted?.files[0]?.telegramFileUniqueId).toBe('telegram-unique-2');
  });
});
