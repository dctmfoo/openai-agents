import process from 'node:process';
import path from 'node:path';
import { Bot } from 'grammy';
import { runPrime } from '../../prime/prime.js';
import { appendScopedDailyNote } from '../../memory/scopedMemory.js';
import { loadFamilyConfig, type FamilyConfig } from '../../runtime/familyConfig.js';
import type { FileMemoryConfig } from '../../runtime/haloConfig.js';
import { getHaloHome } from '../../runtime/haloHome.js';
import { appendJsonl, type EventLogRecord } from '../../utils/logging.js';
import { resolveTelegramPolicy, type TelegramPolicyDecision } from './policy.js';
import { getScopeVectorStoreId } from '../../files/scopeFileRegistry.js';
import {
  indexTelegramDocument,
  type IndexTelegramDocumentResult,
} from '../../files/openaiFileIndexer.js';

type TelegramDocument = {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
};

export type TelegramContext = {
  chat: { id: number; type: string };
  message: { text?: string; document?: TelegramDocument; message_id: number };
  from?: { id?: number | string };
  reply: (text: string) => Promise<unknown>;
  getFile?: () => Promise<{ file_path?: string }>;
  api?: {
    getFile?: (fileId: string) => Promise<{ file_path?: string }>;
  };
};

type TelegramMessageEvent = 'message:text' | 'message:document';

export type TelegramBotLike = {
  on: (event: TelegramMessageEvent, handler: (ctx: TelegramContext) => Promise<void> | void) => void;
  catch: (handler: (err: unknown) => Promise<void> | void) => void;
  start: () => Promise<void>;
};

type DownloadedTelegramFile = {
  bytes: Uint8Array;
};

type TelegramAdapterDeps = {
  runPrime: typeof runPrime;
  appendScopedDailyNote: typeof appendScopedDailyNote;
  appendJsonl: typeof appendJsonl;
  loadFamilyConfig: typeof loadFamilyConfig;
  getScopeVectorStoreId: typeof getScopeVectorStoreId;
  downloadTelegramFile: (ctx: TelegramContext, token: string) => Promise<DownloadedTelegramFile>;
  indexTelegramDocument: (input: {
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
  }) => Promise<IndexTelegramDocumentResult>;
};

export type TelegramAdapterOptions = {
  token: string;
  logDir?: string;
  rootDir?: string;
  haloHome?: string;
  fileMemory?: FileMemoryConfig;
  bot?: TelegramBotLike;
  now?: () => Date;
  deps?: Partial<TelegramAdapterDeps>;
};

export type TelegramAdapter = {
  bot: TelegramBotLike;
  start: () => Promise<void>;
};

const DEFAULT_FILE_MEMORY_CONFIG: FileMemoryConfig = {
  enabled: false,
  uploadEnabled: false,
  maxFileSizeMb: 20,
  allowedExtensions: ['pdf', 'txt', 'md', 'docx', 'pptx', 'csv', 'json', 'html'],
  maxFilesPerScope: 200,
  pollIntervalMs: 1500,
  includeSearchResults: false,
  maxNumResults: 5,
  retention: {
    enabled: false,
    maxAgeDays: 30,
    runIntervalMinutes: 360,
    deleteOpenAIFiles: false,
    maxFilesPerRun: 25,
    dryRun: false,
    keepRecentPerScope: 2,
    maxDeletesPerScopePerRun: 10,
    allowScopeIds: [],
    denyScopeIds: [],
    policyPreset: 'exclude_children',
  },
};

export const UNKNOWN_DM_REPLY =
  'Hi! This bot is private to our family. Please ask a parent to invite you.';

function getFileExtension(filename: string): string | null {
  const normalized = filename.trim();
  const dotIndex = normalized.lastIndexOf('.');
  if (dotIndex < 0 || dotIndex === normalized.length - 1) return null;
  return normalized.slice(dotIndex + 1).toLowerCase();
}

function isAllowedExtension(filename: string, allowedExtensions: string[]): boolean {
  if (allowedExtensions.length === 0) return true;
  const extension = getFileExtension(filename);
  if (!extension) return false;
  const allowed = new Set(allowedExtensions.map((item) => item.toLowerCase()));
  return allowed.has(extension);
}

function buildUploadDownloadMessage(filename: string): string {
  return `Got it. Downloading ${filename} from Telegram…`;
}

function buildUploadIndexingMessage(filename: string): string {
  return `Downloaded ${filename}. Indexing it now — I'll confirm when search is ready.`;
}

function buildUploadIndexFailureMessage(message: string): string {
  if (message === 'File memory limit reached for this chat.') {
    return 'File memory limit reached for this chat. Delete older uploaded files from admin and retry.';
  }

  const normalized = message.trim();
  if (!normalized) {
    return 'Could not index that file right now. Please try again.';
  }

  const clipped = normalized.length > 280 ? `${normalized.slice(0, 277)}...` : normalized;
  return `Could not finish indexing this file: ${clipped}`;
}

async function defaultDownloadTelegramFile(
  ctx: TelegramContext,
  token: string,
): Promise<DownloadedTelegramFile> {
  const document = ctx.message.document;
  if (!document) {
    throw new Error('Document metadata is missing from Telegram context.');
  }

  let file: { file_path?: string } | null = null;

  if (typeof ctx.getFile === 'function') {
    file = await ctx.getFile();
  } else if (ctx.api?.getFile) {
    file = await ctx.api.getFile(document.file_id);
  }

  const filePath = file?.file_path;
  if (!filePath) {
    throw new Error('Telegram file path is missing from getFile response.');
  }

  const response = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
  if (!response.ok) {
    throw new Error(`Failed to download Telegram file (${response.status}).`);
  }

  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
  };
}

export function createTelegramAdapter(options: TelegramAdapterOptions): TelegramAdapter {
  const {
    token,
    haloHome = getHaloHome(process.env),
    logDir = path.join(haloHome, 'logs'),
    rootDir = haloHome,
    bot: providedBot,
    fileMemory = DEFAULT_FILE_MEMORY_CONFIG,
    now = () => new Date(),
    deps = {},
  } = options;

  if (!token) {
    throw new Error('Missing TELEGRAM_BOT_TOKEN in environment');
  }

  const {
    runPrime: runPrimeImpl,
    appendScopedDailyNote: appendScopedDailyNoteImpl,
    appendJsonl: appendJsonlImpl,
    loadFamilyConfig: loadFamilyConfigImpl,
    getScopeVectorStoreId: getScopeVectorStoreIdImpl,
    downloadTelegramFile: downloadTelegramFileImpl,
    indexTelegramDocument: indexTelegramDocumentImpl,
  } = {
    runPrime,
    appendScopedDailyNote,
    appendJsonl,
    loadFamilyConfig,
    getScopeVectorStoreId,
    downloadTelegramFile: defaultDownloadTelegramFile,
    indexTelegramDocument,
    ...deps,
  };

  const logPath = `${logDir}/events.jsonl`;
  const bot = providedBot ?? (new Bot(token) as unknown as TelegramBotLike);

  let familyConfigPromise: Promise<FamilyConfig> | null = null;
  const getFamilyConfig = async () => {
    if (!familyConfigPromise) {
      familyConfigPromise = loadFamilyConfigImpl({ haloHome });
    }
    return familyConfigPromise;
  };

  const writeLog = async (record: EventLogRecord) => {
    await appendJsonlImpl(logPath, record);
  };

  const resolvePolicy = async (ctx: TelegramContext, userId: string): Promise<TelegramPolicyDecision | null> => {
    try {
      const familyConfig = await getFamilyConfig();
      return resolveTelegramPolicy({
        chat: ctx.chat,
        fromId: ctx.from?.id,
        family: familyConfig,
      });
    } catch (err) {
      await writeLog({
        ts: now().toISOString(),
        type: 'prime.run.error',
        data: {
          channel: 'telegram',
          userId,
          error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
        },
      });

      await ctx.reply('Something went wrong while loading family config. Check logs.');
      return null;
    }
  };

  const resolveScopeId = async (
    ctx: TelegramContext,
    userId: string,
    policy: TelegramPolicyDecision,
  ): Promise<string | null> => {
    const scopeId = policy.scopeId;
    if (scopeId) return scopeId;

    await writeLog({
      ts: now().toISOString(),
      type: 'prime.run.error',
      data: {
        channel: 'telegram',
        userId,
        error: { name: 'PolicyError', message: 'Allowed policy decision missing scopeId' },
      },
    });

    await ctx.reply('Something went wrong while computing policy scope. Check logs.');
    return null;
  };

  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text?.trim();
    if (!text) return;

    const userId = String(ctx.from?.id ?? 'unknown');
    await writeLog({
      ts: now().toISOString(),
      type: 'telegram.update',
      data: {
        chatId: ctx.chat.id,
        userId,
        messageId: ctx.message.message_id,
        text,
      },
    });

    const policy = await resolvePolicy(ctx, userId);
    if (!policy) return;

    if (!policy.allow) {
      if (policy.reason === 'unknown_user' && ctx.chat.type === 'private') {
        await ctx.reply(UNKNOWN_DM_REPLY);
      }
      return;
    }

    const scopeId = await resolveScopeId(ctx, userId, policy);
    if (!scopeId) return;

    let fileSearchVectorStoreId: string | null = null;
    if (fileMemory.enabled) {
      try {
        fileSearchVectorStoreId = await getScopeVectorStoreIdImpl({ rootDir, scopeId });
      } catch (err) {
        await writeLog({
          ts: now().toISOString(),
          type: 'prime.run.error',
          data: {
            channel: 'telegram',
            userId,
            scopeId,
            error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
          },
        });
      }
    }

    await writeLog({
      ts: now().toISOString(),
      type: 'prime.run.start',
      data: { channel: 'telegram', userId, scopeId },
    });

    try {
      const result = await runPrimeImpl(text, {
        channel: 'telegram',
        userId,
        scopeId,
        rootDir,
        role: policy.role,
        ageGroup: policy.ageGroup,
        scopeType: policy.scopeType,
        fileSearchEnabled: fileMemory.enabled,
        fileSearchVectorStoreId: fileSearchVectorStoreId ?? undefined,
        fileSearchIncludeResults: fileMemory.includeSearchResults,
        fileSearchMaxNumResults: fileMemory.maxNumResults,
      });
      const finalOutput = String(result.finalOutput ?? '').trim() || '(no output)';

      // Persist a lightweight transcript to the scoped daily memory file.
      await appendScopedDailyNoteImpl({ rootDir, scopeId }, `[user] ${text}`);
      await appendScopedDailyNoteImpl({ rootDir, scopeId }, `[prime] ${finalOutput}`);

      await writeLog({
        ts: now().toISOString(),
        type: 'prime.run.success',
        data: {
          channel: 'telegram',
          userId,
          scopeId,
          finalOutput: result.finalOutput,
        },
      });

      await ctx.reply(finalOutput);
    } catch (err) {
      await writeLog({
        ts: now().toISOString(),
        type: 'prime.run.error',
        data: {
          channel: 'telegram',
          userId,
          error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
        },
      });

      await ctx.reply('Something went wrong while running Prime. Check logs.');
    }
  });

  bot.on('message:document', async (ctx) => {
    const document = ctx.message.document;
    if (!document) return;

    const userId = String(ctx.from?.id ?? 'unknown');
    await writeLog({
      ts: now().toISOString(),
      type: 'telegram.update',
      data: {
        chatId: ctx.chat.id,
        userId,
        messageId: ctx.message.message_id,
        fileId: document.file_id,
        fileUniqueId: document.file_unique_id,
        filename: document.file_name,
        sizeBytes: document.file_size,
        mimeType: document.mime_type,
      },
    });

    const policy = await resolvePolicy(ctx, userId);
    if (!policy) return;

    if (!policy.allow) {
      if (policy.reason === 'unknown_user' && ctx.chat.type === 'private') {
        await ctx.reply(UNKNOWN_DM_REPLY);
      }
      return;
    }

    const scopeId = await resolveScopeId(ctx, userId, policy);
    if (!scopeId) return;

    if (!fileMemory.enabled) {
      await ctx.reply('File memory is disabled right now.');
      return;
    }

    if (!fileMemory.uploadEnabled) {
      await ctx.reply('File uploads are disabled right now.');
      return;
    }

    const filename = document.file_name?.trim() || `telegram-${document.file_unique_id}.bin`;
    const mimeType = document.mime_type?.trim() || 'application/octet-stream';
    const sizeBytes = Number(document.file_size ?? 0);

    const maxSizeBytes = fileMemory.maxFileSizeMb * 1024 * 1024;
    if (sizeBytes > maxSizeBytes) {
      await ctx.reply(`That file is too large. Max allowed is ${fileMemory.maxFileSizeMb} MB.`);
      return;
    }

    if (!isAllowedExtension(filename, fileMemory.allowedExtensions)) {
      const allowed = fileMemory.allowedExtensions.join(', ');
      await ctx.reply(`Unsupported file type. Allowed extensions: ${allowed}.`);
      return;
    }

    await ctx.reply(buildUploadDownloadMessage(filename));

    let downloaded: DownloadedTelegramFile;
    try {
      downloaded = await downloadTelegramFileImpl(ctx, token);
    } catch (err) {
      await writeLog({
        ts: now().toISOString(),
        type: 'prime.run.error',
        data: {
          channel: 'telegram',
          userId,
          scopeId,
          error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
        },
      });
      await ctx.reply('Could not download that file from Telegram. Please try again.');
      return;
    }

    const downloadedSizeBytes = downloaded.bytes.byteLength;
    if (downloadedSizeBytes > maxSizeBytes) {
      await ctx.reply(`That file is too large. Max allowed is ${fileMemory.maxFileSizeMb} MB.`);
      return;
    }

    const effectiveSizeBytes = sizeBytes > 0 ? sizeBytes : downloadedSizeBytes;

    await ctx.reply(buildUploadIndexingMessage(filename));

    try {
      const result = await indexTelegramDocumentImpl({
        rootDir,
        scopeId,
        uploadedBy: policy.memberId ?? userId,
        telegramFileId: document.file_id,
        telegramFileUniqueId: document.file_unique_id,
        filename,
        mimeType,
        sizeBytes: effectiveSizeBytes,
        bytes: downloaded.bytes,
        maxFilesPerScope: fileMemory.maxFilesPerScope,
        pollIntervalMs: fileMemory.pollIntervalMs,
      });

      if (!result.ok) {
        await writeLog({
          ts: now().toISOString(),
          type: 'prime.run.error',
          data: {
            channel: 'telegram',
            userId,
            scopeId,
            error: {
              name: 'FileMemoryIndexError',
              message: result.message,
            },
          },
        });
        await ctx.reply(buildUploadIndexFailureMessage(result.message));
        return;
      }

      await writeLog({
        ts: now().toISOString(),
        type: 'prime.run.success',
        data: {
          channel: 'telegram',
          userId,
          scopeId,
          action: 'file_upload',
          filename: result.filename,
        },
      });

      await ctx.reply(`Uploaded ${result.filename}. It is now searchable in this chat.`);
    } catch (err) {
      await writeLog({
        ts: now().toISOString(),
        type: 'prime.run.error',
        data: {
          channel: 'telegram',
          userId,
          scopeId,
          error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
        },
      });

      await ctx.reply('Could not index that file right now. Please try again.');
    }
  });

  bot.catch(async (err) => {
    const e = err as { error?: { message?: string } | string };
    await writeLog({
      ts: now().toISOString(),
      type: 'prime.run.error',
      data: {
        channel: 'telegram',
        error: {
          message: e?.error && typeof e.error === 'object' ? e.error.message : String(e?.error ?? err),
        },
      },
    });
  });

  return {
    bot,
    start: () => bot.start(),
  };
}
