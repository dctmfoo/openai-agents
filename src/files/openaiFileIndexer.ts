import OpenAI, { toFile } from 'openai';
import { buildLaneStorageMetadata } from '../memory/laneTopology.js';
import { hashSessionId } from '../sessions/sessionHash.js';
import {
  getScopeVectorStoreId,
  readScopeFileRegistry,
  setScopeVectorStoreId,
  upsertScopeFileRecord,
} from './scopeFileRegistry.js';

type VectorStoreFileStatus = 'in_progress' | 'completed' | 'cancelled' | 'failed';

type OpenAIClientLike = {
  vectorStores: {
    create: (input: { name: string }) => Promise<{ id: string }>;
    files: {
      createAndPoll: (
        vectorStoreId: string,
        body: { file_id: string },
        options?: { pollIntervalMs?: number },
      ) => Promise<{
        id: string;
        status: VectorStoreFileStatus;
        last_error?: { message?: string } | null;
      }>;
    };
  };
  files: {
    create: (input: { file: unknown; purpose: 'assistants' }) => Promise<{ id: string }>;
  };
};

type ToFileLike = (
  value: unknown,
  name?: string | null,
  options?: { type?: string; lastModified?: number },
) => Promise<unknown>;

type IndexTelegramDocumentInput = {
  rootDir: string;
  scopeId: string;
  uploadedBy: string;
  telegramFileId: string;
  telegramFileUniqueId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  bytes: Uint8Array;
  maxFilesPerScope: number;
  pollIntervalMs: number;
  laneId?: string;
  policyVersion?: string;
};

export type IndexTelegramDocumentResult =
  | { ok: true; filename: string }
  | { ok: false; message: string };

type IndexTelegramDocumentDeps = {
  client?: OpenAIClientLike;
  toFile?: ToFileLike;
  nowMs?: () => number;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
  retryBaseDelayMs?: number;
};

type RetryOptions = {
  maxRetries: number;
  baseDelayMs: number;
  sleep: (ms: number) => Promise<void>;
};

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 250;

const scopeLocks = new Map<string, Promise<void>>();

const defaultSleep = async (ms: number) =>
  await new Promise<void>((resolve) => setTimeout(resolve, ms));

const createScopeVectorStoreName = (scopeId: string): string => {
  const shortHash = hashSessionId(scopeId).slice(0, 12);
  return `halo-scope-${shortHash}`;
};

function getDefaultOpenAIClient(): OpenAIClientLike {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for file indexing.');
  }

  return new OpenAI({ apiKey }) as unknown as OpenAIClientLike;
}

function getDefaultToFile(): ToFileLike {
  return toFile as unknown as ToFileLike;
}

function normalizeErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim()) {
    return err.message;
  }

  if (err && typeof err === 'object' && 'message' in err) {
    const value = (err as { message?: unknown }).message;
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }

  return String(err);
}

function isRetryableError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;

  const status = (err as { status?: unknown }).status;
  if (typeof status === 'number' && (status === 429 || status >= 500)) {
    return true;
  }

  const name = (err as { name?: unknown }).name;
  if (typeof name === 'string') {
    if (
      name === 'RateLimitError' ||
      name === 'APIConnectionError' ||
      name === 'APIConnectionTimeoutError' ||
      name === 'InternalServerError'
    ) {
      return true;
    }
  }

  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string') {
    if (['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)) {
      return true;
    }
  }

  return false;
}

async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  let attempt = 0;

  while (true) {
    try {
      return await operation();
    } catch (err) {
      if (!isRetryableError(err) || attempt >= options.maxRetries) {
        throw err;
      }

      const delayMs = options.baseDelayMs * 2 ** attempt;
      attempt += 1;
      await options.sleep(delayMs);
    }
  }
}

async function withScopeLock<T>(scopeId: string, work: () => Promise<T>): Promise<T> {
  const previous = scopeLocks.get(scopeId) ?? Promise.resolve();

  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });

  const queueEntry = previous.then(() => current);
  scopeLocks.set(scopeId, queueEntry);

  await previous;

  try {
    return await work();
  } finally {
    release();
    if (scopeLocks.get(scopeId) === queueEntry) {
      scopeLocks.delete(scopeId);
    }
  }
}

function buildFailedIndexMessage(status: VectorStoreFileStatus, lastError?: string | null): string {
  if (lastError && lastError.trim()) return lastError;
  if (status === 'failed' || status === 'cancelled') {
    return 'OpenAI failed to index this file.';
  }
  return `OpenAI indexing did not complete (status: ${status}).`;
}

function buildDocumentStorageMetadata(input: IndexTelegramDocumentInput) {
  const laneId = input.laneId?.trim() || 'system_audit';
  const policyVersion = input.policyVersion?.trim() || 'unknown';

  return buildLaneStorageMetadata({
    laneId,
    ownerMemberId: input.uploadedBy,
    scopeId: input.scopeId,
    policyVersion,
    artifactType: 'document',
  });
}

export async function indexTelegramDocument(
  input: IndexTelegramDocumentInput,
  deps: IndexTelegramDocumentDeps = {},
): Promise<IndexTelegramDocumentResult> {
  const nowMs = deps.nowMs ?? (() => Date.now());
  const storageMetadata = buildDocumentStorageMetadata(input);

  return await withScopeLock(input.scopeId, async () => {
    const registry = await readScopeFileRegistry({
      rootDir: input.rootDir,
      scopeId: input.scopeId,
    });

    const existing =
      registry?.files.find(
        (entry) =>
          entry.telegramFileUniqueId === input.telegramFileUniqueId ||
          entry.telegramFileId === input.telegramFileId,
      ) ?? null;

    if (existing?.status === 'completed') {
      return {
        ok: true,
        filename: existing.filename,
      };
    }

    const effectiveCount =
      registry?.files.filter((entry) => entry.status !== 'failed').length ?? 0;

    if (!existing && effectiveCount >= input.maxFilesPerScope) {
      return {
        ok: false,
        message: 'File memory limit reached for this chat.',
      };
    }

    const retryOptions: RetryOptions = {
      maxRetries: deps.maxRetries ?? DEFAULT_MAX_RETRIES,
      baseDelayMs: deps.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS,
      sleep: deps.sleep ?? defaultSleep,
    };

    const client = deps.client ?? getDefaultOpenAIClient();
    const toFileImpl = deps.toFile ?? getDefaultToFile();

    let vectorStoreId = await getScopeVectorStoreId({
      rootDir: input.rootDir,
      scopeId: input.scopeId,
    });

    if (!vectorStoreId) {
      const vectorStore = await withRetry(
        async () =>
          await client.vectorStores.create({
            name: createScopeVectorStoreName(input.scopeId),
          }),
        retryOptions,
      );
      vectorStoreId = vectorStore.id;
      await setScopeVectorStoreId(
        { rootDir: input.rootDir, scopeId: input.scopeId },
        vectorStoreId,
        nowMs(),
      );
    }

    let openaiFileId: string | null = null;

    try {
      const fileObject = await toFileImpl(input.bytes, input.filename, {
        type: input.mimeType,
        lastModified: nowMs(),
      });

      const openaiFile = await withRetry(
        async () =>
          await client.files.create({
            file: fileObject,
            purpose: 'assistants',
          }),
        retryOptions,
      );
      openaiFileId = openaiFile.id;

      const vectorStoreFile = await withRetry(
        async () =>
          await client.vectorStores.files.createAndPoll(
            vectorStoreId,
            { file_id: openaiFile.id },
            { pollIntervalMs: input.pollIntervalMs },
          ),
        retryOptions,
      );

      const errorMessage = buildFailedIndexMessage(
        vectorStoreFile.status,
        vectorStoreFile.last_error?.message,
      );
      const vectorStoreFileId =
        typeof vectorStoreFile.id === 'string' && vectorStoreFile.id.trim()
          ? vectorStoreFile.id
          : null;

      if (vectorStoreFile.status !== 'completed') {
        await upsertScopeFileRecord(
          { rootDir: input.rootDir, scopeId: input.scopeId },
          {
            telegramFileId: input.telegramFileId,
            telegramFileUniqueId: input.telegramFileUniqueId,
            filename: input.filename,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            openaiFileId: openaiFile.id,
            vectorStoreFileId,
            status: 'failed',
            lastError: errorMessage,
            uploadedBy: input.uploadedBy,
            uploadedAtMs: nowMs(),
            storageMetadata,
          },
          nowMs(),
        );

        return {
          ok: false,
          message: errorMessage,
        };
      }

      if (!vectorStoreFileId) {
        const missingIdMessage =
          'OpenAI indexing completed without a vector-store file id.';

        await upsertScopeFileRecord(
          { rootDir: input.rootDir, scopeId: input.scopeId },
          {
            telegramFileId: input.telegramFileId,
            telegramFileUniqueId: input.telegramFileUniqueId,
            filename: input.filename,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            openaiFileId: openaiFile.id,
            vectorStoreFileId: null,
            status: 'failed',
            lastError: missingIdMessage,
            uploadedBy: input.uploadedBy,
            uploadedAtMs: nowMs(),
            storageMetadata,
          },
          nowMs(),
        );

        return {
          ok: false,
          message: missingIdMessage,
        };
      }

      await upsertScopeFileRecord(
        { rootDir: input.rootDir, scopeId: input.scopeId },
        {
          telegramFileId: input.telegramFileId,
          telegramFileUniqueId: input.telegramFileUniqueId,
          filename: input.filename,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          openaiFileId: openaiFile.id,
          vectorStoreFileId,
          status: 'completed',
          lastError: null,
          uploadedBy: input.uploadedBy,
          uploadedAtMs: nowMs(),
          storageMetadata,
        },
        nowMs(),
      );

      return {
        ok: true,
        filename: input.filename,
      };
    } catch (err) {
      const message = normalizeErrorMessage(err);

      if (openaiFileId) {
        await upsertScopeFileRecord(
          { rootDir: input.rootDir, scopeId: input.scopeId },
          {
            telegramFileId: input.telegramFileId,
            telegramFileUniqueId: input.telegramFileUniqueId,
            filename: input.filename,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            openaiFileId,
            vectorStoreFileId: null,
            status: 'failed',
            lastError: message,
            uploadedBy: input.uploadedBy,
            uploadedAtMs: nowMs(),
            storageMetadata,
          },
          nowMs(),
        );
      }

      return {
        ok: false,
        message,
      };
    }
  });
}
