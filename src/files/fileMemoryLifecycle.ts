import OpenAI from 'openai';

import {
  readScopeFileRegistry,
  replaceScopeFileRecords,
  type ScopeFileRecord,
} from './scopeFileRegistry.js';

type OpenAIClientLike = {
  vectorStores: {
    files: {
      delete: (
        vectorStoreFileId: string,
        params: { vector_store_id: string },
      ) => Promise<unknown>;
    };
  };
  files: {
    delete: (openaiFileId: string) => Promise<unknown>;
  };
};

type LifecycleDeps = {
  client?: OpenAIClientLike;
  nowMs?: () => number;
};

type ScopePaths = {
  rootDir: string;
  scopeId: string;
};

type DeleteScopeUploadedFileInput = ScopePaths & {
  fileRef: string;
  deleteOpenAIFile: boolean;
};

type PurgeScopeUploadedFilesInput = ScopePaths & {
  deleteOpenAIFiles: boolean;
};

type FileListResult = {
  scopeId: string;
  vectorStoreId: string | null;
  files: ScopeFileRecord[];
};

type DeleteScopeUploadedFileResult =
  | { ok: true; deleted: boolean; removed: ScopeFileRecord | null }
  | { ok: false; code: 'scope_not_found' | 'file_not_found' | 'remote_delete_failed'; message: string };

type PurgeScopeUploadedFilesResult = {
  ok: boolean;
  removedCount: number;
  remainingCount: number;
  errors: Array<{ fileRef: string; message: string }>;
};

function getDefaultOpenAIClient(): OpenAIClientLike {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for file lifecycle operations.');
  }

  return new OpenAI({ apiKey }) as unknown as OpenAIClientLike;
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message;

  if (err && typeof err === 'object' && 'message' in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }

  return String(err);
}

async function deleteRemoteVectorStoreFile(
  client: OpenAIClientLike,
  vectorStoreId: string | null,
  vectorStoreFileId: string,
): Promise<void> {
  if (!vectorStoreId) {
    throw new Error('Vector store is not configured for this scope.');
  }

  await client.vectorStores.files.delete(vectorStoreFileId, {
    vector_store_id: vectorStoreId,
  });
}

function findFileIndex(files: ScopeFileRecord[], fileRef: string): number {
  return files.findIndex(
    (entry) =>
      entry.telegramFileUniqueId === fileRef ||
      entry.telegramFileId === fileRef ||
      entry.openaiFileId === fileRef ||
      entry.vectorStoreFileId === fileRef,
  );
}

export async function listScopeUploadedFiles(input: ScopePaths): Promise<FileListResult> {
  const registry = await readScopeFileRegistry(input);
  if (!registry) {
    return {
      scopeId: input.scopeId,
      vectorStoreId: null,
      files: [],
    };
  }

  return {
    scopeId: input.scopeId,
    vectorStoreId: registry.vectorStoreId,
    files: registry.files,
  };
}

export async function deleteScopeUploadedFile(
  input: DeleteScopeUploadedFileInput,
  deps: LifecycleDeps = {},
): Promise<DeleteScopeUploadedFileResult> {
  const nowMs = deps.nowMs ?? (() => Date.now());

  const registry = await readScopeFileRegistry({
    rootDir: input.rootDir,
    scopeId: input.scopeId,
  });

  if (!registry) {
    return {
      ok: false,
      code: 'scope_not_found',
      message: 'No file-memory registry found for this scope.',
    };
  }

  const index = findFileIndex(registry.files, input.fileRef);
  if (index < 0) {
    return {
      ok: false,
      code: 'file_not_found',
      message: 'File not found in this scope.',
    };
  }

  const target = registry.files[index];

  try {
    const needsRemoteDelete = Boolean(target.vectorStoreFileId);
    const needsOpenAIDelete = Boolean(input.deleteOpenAIFile && target.openaiFileId);

    if (needsRemoteDelete || needsOpenAIDelete) {
      const client = deps.client ?? getDefaultOpenAIClient();

      if (target.vectorStoreFileId) {
        await deleteRemoteVectorStoreFile(client, registry.vectorStoreId, target.vectorStoreFileId);
      }

      if (input.deleteOpenAIFile && target.openaiFileId) {
        await client.files.delete(target.openaiFileId);
      }
    }
  } catch (err) {
    return {
      ok: false,
      code: 'remote_delete_failed',
      message: toErrorMessage(err),
    };
  }

  const files = registry.files.filter((_, idx) => idx !== index);
  await replaceScopeFileRecords(
    { rootDir: input.rootDir, scopeId: input.scopeId },
    files,
    nowMs(),
  );

  return {
    ok: true,
    deleted: true,
    removed: target,
  };
}

export async function purgeScopeUploadedFiles(
  input: PurgeScopeUploadedFilesInput,
  deps: LifecycleDeps = {},
): Promise<PurgeScopeUploadedFilesResult> {
  const nowMs = deps.nowMs ?? (() => Date.now());

  const registry = await readScopeFileRegistry({
    rootDir: input.rootDir,
    scopeId: input.scopeId,
  });

  if (!registry || registry.files.length === 0) {
    return {
      ok: true,
      removedCount: 0,
      remainingCount: 0,
      errors: [],
    };
  }

  const remaining: ScopeFileRecord[] = [];
  const errors: Array<{ fileRef: string; message: string }> = [];
  let removedCount = 0;

  for (const file of registry.files) {
    try {
      const needsRemoteDelete = Boolean(file.vectorStoreFileId);
      const needsOpenAIDelete = Boolean(input.deleteOpenAIFiles && file.openaiFileId);

      if (needsRemoteDelete || needsOpenAIDelete) {
        const client = deps.client ?? getDefaultOpenAIClient();

        if (file.vectorStoreFileId) {
          await deleteRemoteVectorStoreFile(client, registry.vectorStoreId, file.vectorStoreFileId);
        }

        if (input.deleteOpenAIFiles && file.openaiFileId) {
          await client.files.delete(file.openaiFileId);
        }
      }

      removedCount += 1;
    } catch (err) {
      remaining.push(file);
      errors.push({
        fileRef: file.telegramFileUniqueId,
        message: toErrorMessage(err),
      });
    }
  }

  await replaceScopeFileRecords(
    { rootDir: input.rootDir, scopeId: input.scopeId },
    remaining,
    nowMs(),
  );

  return {
    ok: errors.length === 0,
    removedCount,
    remainingCount: remaining.length,
    errors,
  };
}
