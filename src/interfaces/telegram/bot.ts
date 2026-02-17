import process from 'node:process';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { type AgentInputItem } from '@openai/agents';
import { Bot } from 'grammy';
import { runPrime } from '../../prime/prime.js';
import { appendScopedDailyNote } from '../../memory/scopedMemory.js';
import { loadFamilyConfig, type FamilyConfig } from '../../runtime/familyConfig.js';
import type { FileMemoryConfig, ToolsConfig } from '../../runtime/haloConfig.js';
import { getHaloHome } from '../../runtime/haloHome.js';
import { appendJsonl, type EventLogRecord } from '../../utils/logging.js';
import { createRuntimeLogger, serializeError } from '../../utils/runtimeLogger.js';
import { resolveTelegramPolicy, type TelegramPolicyDecision } from './policy.js';
import { getScopeVectorStoreId } from '../../files/scopeFileRegistry.js';
import { hashSessionId } from '../../sessions/sessionHash.js';
import { TOOL_NAMES } from '../../tools/toolNames.js';
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

type TelegramPhotoSize = {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
};

export type TelegramContext = {
  chat: { id: number; type: string };
  message: {
    text?: string;
    caption?: string;
    document?: TelegramDocument;
    photo?: TelegramPhotoSize[];
    message_id: number;
  };
  from?: { id?: number | string };
  reply: (text: string) => Promise<unknown>;
  getFile?: () => Promise<{ file_path?: string }>;
  api?: {
    getFile?: (fileId: string) => Promise<{ file_path?: string }>;
  };
};

type TelegramMessageEvent = 'message:text' | 'message:document' | 'message:photo';

export type TelegramBotLike = {
  on: (event: TelegramMessageEvent, handler: (ctx: TelegramContext) => Promise<void> | void) => void;
  catch: (handler: (err: unknown) => Promise<void> | void) => void;
  start: () => Promise<void>;
};

type DownloadedTelegramFile = {
  bytes: Uint8Array;
  filePath?: string;
};

type TelegramAdapterDeps = {
  runPrime: typeof runPrime;
  appendScopedDailyNote: typeof appendScopedDailyNote;
  appendJsonl: typeof appendJsonl;
  loadFamilyConfig: typeof loadFamilyConfig;
  getScopeVectorStoreId: typeof getScopeVectorStoreId;
  downloadTelegramFile: (input: {
    ctx: TelegramContext;
    token: string;
    fileId: string;
  }) => Promise<DownloadedTelegramFile>;
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
  toolsConfig?: ToolsConfig;
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

const TELEGRAM_VISION_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const TELEGRAM_VISION_DEFAULT_PROMPT =
  'Please describe this image and answer the user question if one was included. Keep the response concise unless detailed analysis is requested.';
const TELEGRAM_VISION_DISABLED_TOOLS = [
  TOOL_NAMES.webSearch,
  TOOL_NAMES.readScopedMemory,
  TOOL_NAMES.rememberDaily,
  TOOL_NAMES.semanticSearch,
  TOOL_NAMES.fileSearch,
  TOOL_NAMES.shell,
] as const;

const TELEGRAM_RESTART_EXIT_CODE = 43;
const TELEGRAM_RESTART_DELAY_MS = 1000;
const TELEGRAM_RESTART_REPLY = '🔨 Building and restarting halo...';
const TELEGRAM_RESTART_DENIED_REPLY = 'Restart is only available in parent DMs.';
const TELEGRAM_RESTART_COMMANDS = new Set(['restart', 'br']);

type TelegramSlashCommand = {
  commandName: string;
  addressedBotUsername?: string;
  args: string;
};

function parseTelegramSlashCommand(text: string): TelegramSlashCommand | null {
  const match = text.match(/^\/([a-zA-Z0-9_]+)(?:@([a-zA-Z0-9_]+))?(?:\s+([\s\S]+))?$/i);
  if (!match) return null;

  return {
    commandName: match[1].toLowerCase(),
    addressedBotUsername: match[2],
    args: match[3]?.trim() ?? '',
  };
}

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

function buildUploadId(ctx: TelegramContext, document: TelegramDocument): string {
  return `${ctx.chat.id}:${ctx.message.message_id}:${document.file_unique_id}`;
}

function getLargestPhotoSize(photoSizes: TelegramPhotoSize[]): TelegramPhotoSize {
  if (photoSizes.length === 1) return photoSizes[0];

  return photoSizes.reduce((best, current) => {
    const bestPixels = best.width * best.height;
    const currentPixels = current.width * current.height;

    if (currentPixels > bestPixels) return current;

    if (currentPixels === bestPixels) {
      const bestSize = best.file_size ?? 0;
      const currentSize = current.file_size ?? 0;
      if (currentSize > bestSize) return current;
    }

    return best;
  });
}

function isImageMimeType(mimeType: string | undefined): boolean {
  return typeof mimeType === 'string' && mimeType.toLowerCase().startsWith('image/');
}

function inferMimeTypeFromExtension(extension: string | null): string | null {
  if (!extension) return null;
  const normalized = extension.toLowerCase();
  if (normalized === 'jpg' || normalized === 'jpeg') return 'image/jpeg';
  if (normalized === 'png') return 'image/png';
  if (normalized === 'webp') return 'image/webp';
  if (normalized === 'gif') return 'image/gif';
  if (normalized === 'bmp') return 'image/bmp';
  if (normalized === 'heic') return 'image/heic';
  if (normalized === 'heif') return 'image/heif';
  return null;
}

function inferExtensionFromMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized === 'image/jpeg') return 'jpg';
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/webp') return 'webp';
  if (normalized === 'image/gif') return 'gif';
  if (normalized === 'image/bmp') return 'bmp';
  if (normalized === 'image/heic') return 'heic';
  if (normalized === 'image/heif') return 'heif';
  return 'bin';
}

function detectImageMimeType(bytes: Uint8Array): string | null {
  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }

  if (
    bytes.byteLength >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }

  if (
    bytes.byteLength >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }

  if (
    bytes.byteLength >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return 'image/gif';
  }

  return null;
}

function toSafePathSegment(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  return normalized || 'image';
}

function buildVisionPrompt(caption: string | undefined): string {
  const text = caption?.trim();
  return text && text.length > 0 ? text : TELEGRAM_VISION_DEFAULT_PROMPT;
}

function getScopeImageDir(rootDir: string, scopeId: string, date: Date): string {
  const hashedScope = hashSessionId(scopeId);
  const iso = date.toISOString().slice(0, 10);
  return path.join(rootDir, 'memory', 'scopes', hashedScope, 'images', iso);
}

function toBase64(input: Uint8Array): string {
  return Buffer.from(input).toString('base64');
}

function buildImageDataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${toBase64(bytes)}`;
}

function buildVisionImageFilename(input: {
  source: 'photo' | 'document';
  date: Date;
  messageId: number;
  fileUniqueId: string;
  extension: string;
}): string {
  const compactTs = input.date.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const safeUniqueId = toSafePathSegment(input.fileUniqueId).slice(0, 48);
  return `${compactTs}-${input.source}-${input.messageId}-${safeUniqueId}.${input.extension}`;
}

function toRelativePath(rootDir: string, targetPath: string): string {
  return path.relative(rootDir, targetPath).split(path.sep).join('/');
}

async function persistScopedVisionImage(input: {
  rootDir: string;
  scopeId: string;
  source: 'photo' | 'document';
  date: Date;
  messageId: number;
  fileUniqueId: string;
  extension: string;
  bytes: Uint8Array;
}): Promise<{ absolutePath: string; relativePath: string; filename: string }> {
  const baseDir = getScopeImageDir(input.rootDir, input.scopeId, input.date);
  await mkdir(baseDir, { recursive: true });

  const filename = buildVisionImageFilename({
    source: input.source,
    date: input.date,
    messageId: input.messageId,
    fileUniqueId: input.fileUniqueId,
    extension: input.extension,
  });
  const absolutePath = path.join(baseDir, filename);
  await writeFile(absolutePath, input.bytes);

  return {
    absolutePath,
    relativePath: toRelativePath(input.rootDir, absolutePath),
    filename,
  };
}

async function defaultDownloadTelegramFile(
  input: {
    ctx: TelegramContext;
    token: string;
    fileId: string;
  },
): Promise<DownloadedTelegramFile> {
  const { ctx, token, fileId } = input;

  let file: { file_path?: string } | null = null;

  if (ctx.api?.getFile) {
    file = await ctx.api.getFile(fileId);
  } else if (typeof ctx.getFile === 'function') {
    file = await ctx.getFile();
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
    filePath,
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
    toolsConfig,
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
  const runtimeLogger = createRuntimeLogger({
    logDir,
    component: 'telegram.bot',
  });
  const bot = providedBot ?? (new Bot(token) as unknown as TelegramBotLike);

  runtimeLogger.info('adapter initialized', {
    rootDir,
    haloHome,
    fileMemoryEnabled: fileMemory.enabled,
    fileUploadEnabled: fileMemory.uploadEnabled,
    shellToolEnabled: toolsConfig?.shell?.enabled ?? false,
  });

  let familyConfigPromise: Promise<FamilyConfig> | null = null;
  const getFamilyConfig = async () => {
    if (!familyConfigPromise) {
      familyConfigPromise = loadFamilyConfigImpl({ haloHome });
    }
    return familyConfigPromise;
  };

  const writeLog = async (record: EventLogRecord) => {
    await appendJsonlImpl(logPath, record);

    if (record.type === 'prime.run.error') {
      runtimeLogger.error('prime.run.error', record.data);
      return;
    }

    if (record.type === 'prime.run.success') {
      runtimeLogger.info('prime.run.success', {
        channel: record.data.channel,
        scopeId: record.data.scopeId,
        action: record.data.action ?? 'chat',
      });
      return;
    }

    if (record.type === 'file.upload') {
      const stage = String(record.data.stage ?? 'unknown');
      if (
        stage === 'policy_denied' ||
        stage === 'validation_failed' ||
        stage === 'download_failed' ||
        stage === 'index_failed'
      ) {
        runtimeLogger.warn(`file.upload.${stage}`, record.data);
      }
    }
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
          error: serializeError(err),
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

  const handleVisionMessage = async (
    ctx: TelegramContext,
    input: {
      source: 'photo' | 'document';
      uploadId: string;
      fileId: string;
      fileUniqueId: string;
      filename?: string;
      mimeType?: string;
      declaredSizeBytes?: number;
      caption?: string;
      width?: number;
      height?: number;
    },
  ) => {
    const receivedAt = now();
    const elapsedMs = () => Math.max(0, now().getTime() - receivedAt.getTime());
    const userId = String(ctx.from?.id ?? 'unknown');

    const policy = await resolvePolicy(ctx, userId);
    if (!policy) return;

    if (!policy.allow) {
      await writeLog({
        ts: now().toISOString(),
        type: 'file.upload',
        data: {
          stage: 'policy_denied',
          uploadId: input.uploadId,
          chatId: ctx.chat.id,
          userId,
          reason: policy.reason ?? 'unknown',
          source: input.source,
        },
      });

      if (policy.reason === 'unknown_user' && ctx.chat.type === 'private') {
        await ctx.reply(UNKNOWN_DM_REPLY);
      }
      return;
    }

    const scopeId = await resolveScopeId(ctx, userId, policy);
    if (!scopeId) return;

    await writeLog({
      ts: now().toISOString(),
      type: 'file.upload',
      data: {
        stage: 'vision_received',
        uploadId: input.uploadId,
        source: input.source,
        chatId: ctx.chat.id,
        userId,
        scopeId,
        messageId: ctx.message.message_id,
        telegramFileId: input.fileId,
        telegramFileUniqueId: input.fileUniqueId,
        filename: input.filename ?? null,
        mimeType: input.mimeType ?? null,
        declaredSizeBytes: input.declaredSizeBytes ?? null,
        width: input.width ?? null,
        height: input.height ?? null,
      },
    });

    let downloaded: DownloadedTelegramFile;
    try {
      downloaded = await downloadTelegramFileImpl({
        ctx,
        token,
        fileId: input.fileId,
      });
    } catch (err) {
      await writeLog({
        ts: now().toISOString(),
        type: 'file.upload',
        data: {
          stage: 'download_failed',
          uploadId: input.uploadId,
          source: input.source,
          chatId: ctx.chat.id,
          userId,
          scopeId,
          durationMs: elapsedMs(),
          error: serializeError(err),
        },
      });

      await ctx.reply('Could not download that image from Telegram. Please try again.');
      return;
    }

    const downloadedSizeBytes = downloaded.bytes.byteLength;
    if (downloadedSizeBytes > TELEGRAM_VISION_MAX_IMAGE_BYTES) {
      await writeLog({
        ts: now().toISOString(),
        type: 'file.upload',
        data: {
          stage: 'validation_failed',
          reason: 'vision_size_exceeded',
          uploadId: input.uploadId,
          source: input.source,
          chatId: ctx.chat.id,
          userId,
          scopeId,
          downloadedSizeBytes,
          maxSizeBytes: TELEGRAM_VISION_MAX_IMAGE_BYTES,
          durationMs: elapsedMs(),
        },
      });

      await ctx.reply('That image is too large. Please send one under 20 MB.');
      return;
    }

    const declaredMimeType = isImageMimeType(input.mimeType)
      ? input.mimeType?.toLowerCase()
      : undefined;
    const fileNameExtension = getFileExtension(input.filename ?? '');
    const filePathExtension = getFileExtension(downloaded.filePath ?? '');
    const resolvedMimeType =
      declaredMimeType ??
      inferMimeTypeFromExtension(fileNameExtension) ??
      inferMimeTypeFromExtension(filePathExtension) ??
      detectImageMimeType(downloaded.bytes);

    if (!resolvedMimeType || !resolvedMimeType.startsWith('image/')) {
      await writeLog({
        ts: now().toISOString(),
        type: 'file.upload',
        data: {
          stage: 'validation_failed',
          reason: 'vision_unsupported_mime',
          uploadId: input.uploadId,
          source: input.source,
          chatId: ctx.chat.id,
          userId,
          scopeId,
          mimeType: input.mimeType ?? null,
          filename: input.filename ?? null,
          filePath: downloaded.filePath ?? null,
          durationMs: elapsedMs(),
        },
      });

      await ctx.reply('I can only analyze image files for vision right now.');
      return;
    }

    const extension =
      fileNameExtension ??
      filePathExtension ??
      inferExtensionFromMimeType(resolvedMimeType);

    let persisted: { absolutePath: string; relativePath: string; filename: string };
    try {
      persisted = await persistScopedVisionImage({
        rootDir,
        scopeId,
        source: input.source,
        date: receivedAt,
        messageId: ctx.message.message_id,
        fileUniqueId: input.fileUniqueId,
        extension,
        bytes: downloaded.bytes,
      });
    } catch (err) {
      await writeLog({
        ts: now().toISOString(),
        type: 'prime.run.error',
        data: {
          channel: 'telegram',
          action: 'vision_storage',
          userId,
          scopeId,
          source: input.source,
          error: serializeError(err),
        },
      });

      await ctx.reply('Could not store that image for this chat. Please try again.');
      return;
    }

    await writeLog({
      ts: now().toISOString(),
      type: 'file.upload',
      data: {
        stage: 'vision_stored',
        uploadId: input.uploadId,
        source: input.source,
        chatId: ctx.chat.id,
        userId,
        scopeId,
        storedPath: persisted.relativePath,
        mimeType: resolvedMimeType,
        downloadedSizeBytes,
      },
    });

    const promptText = buildVisionPrompt(input.caption);
    const dataUrl = buildImageDataUrl(downloaded.bytes, resolvedMimeType);
    const visionInput: AgentInputItem[] = [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: promptText },
          { type: 'input_image', image: dataUrl, detail: 'auto' },
        ],
      },
    ];

    await writeLog({
      ts: now().toISOString(),
      type: 'prime.run.start',
      data: {
        channel: 'telegram',
        action: 'vision',
        userId,
        scopeId,
        source: input.source,
        storedPath: persisted.relativePath,
      },
    });

    try {
      const result = await runPrimeImpl(visionInput, {
        channel: 'telegram',
        userId,
        scopeId,
        rootDir,
        role: policy.role,
        ageGroup: policy.ageGroup,
        scopeType: policy.scopeType,
        fileSearchEnabled: false,
        contextMode: 'light',
        disabledToolNames: [...TELEGRAM_VISION_DISABLED_TOOLS],
        disableSession: true,
        toolsConfig,
      });
      const finalOutput = String(result.finalOutput ?? '').trim() || '(no output)';

      const rawCaption = input.caption?.trim();
      const captionNote = rawCaption && rawCaption.length > 0 ? rawCaption : '(no caption)';
      await appendScopedDailyNoteImpl(
        { rootDir, scopeId },
        `[user:image:${input.source}] ${captionNote} [file:${persisted.relativePath}]`,
      );
      await appendScopedDailyNoteImpl({ rootDir, scopeId }, `[prime] ${finalOutput}`);

      await writeLog({
        ts: now().toISOString(),
        type: 'prime.run.success',
        data: {
          channel: 'telegram',
          action: 'vision',
          userId,
          scopeId,
          source: input.source,
          storedPath: persisted.relativePath,
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
          action: 'vision',
          userId,
          scopeId,
          source: input.source,
          storedPath: persisted.relativePath,
          error: serializeError(err),
        },
      });

      await ctx.reply('Something went wrong while analyzing that image. Please try again.');
    }
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

    const slashCommand = parseTelegramSlashCommand(text);
    if (slashCommand && TELEGRAM_RESTART_COMMANDS.has(slashCommand.commandName)) {
      if (policy.role !== 'parent' || policy.scopeType !== 'dm') {
        await ctx.reply(TELEGRAM_RESTART_DENIED_REPLY);
        return;
      }

      await writeLog({
        ts: now().toISOString(),
        type: 'prime.run.success',
        data: {
          channel: 'telegram',
          action: 'restart_requested',
          userId,
          scopeId,
          command: slashCommand.commandName,
        },
      });

      await ctx.reply(TELEGRAM_RESTART_REPLY);
      setTimeout(() => {
        process.exit(TELEGRAM_RESTART_EXIT_CODE);
      }, TELEGRAM_RESTART_DELAY_MS);
      return;
    }

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
            error: serializeError(err),
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
        toolsConfig,
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
          error: serializeError(err),
        },
      });

      await ctx.reply('Something went wrong while running Prime. Check logs.');
    }
  });

  bot.on('message:document', async (ctx) => {
    const document = ctx.message.document;
    if (!document) return;

    const receivedAtMs = now().getTime();
    const elapsedMs = () => Math.max(0, now().getTime() - receivedAtMs);
    const userId = String(ctx.from?.id ?? 'unknown');
    const uploadId = buildUploadId(ctx, document);

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

    await writeLog({
      ts: now().toISOString(),
      type: 'file.upload',
      data: {
        stage: 'received',
        uploadId,
        chatId: ctx.chat.id,
        userId,
        messageId: ctx.message.message_id,
        telegramFileId: document.file_id,
        telegramFileUniqueId: document.file_unique_id,
        filename: document.file_name ?? null,
        mimeType: document.mime_type ?? null,
        declaredSizeBytes: document.file_size ?? null,
      },
    });

    if (isImageMimeType(document.mime_type)) {
      await handleVisionMessage(ctx, {
        source: 'document',
        uploadId,
        fileId: document.file_id,
        fileUniqueId: document.file_unique_id,
        filename: document.file_name,
        mimeType: document.mime_type,
        declaredSizeBytes: document.file_size,
        caption: ctx.message.caption,
      });
      return;
    }

    const policy = await resolvePolicy(ctx, userId);
    if (!policy) return;

    if (!policy.allow) {
      await writeLog({
        ts: now().toISOString(),
        type: 'file.upload',
        data: {
          stage: 'policy_denied',
          uploadId,
          chatId: ctx.chat.id,
          userId,
          reason: policy.reason ?? 'unknown',
          durationMs: elapsedMs(),
        },
      });

      if (policy.reason === 'unknown_user' && ctx.chat.type === 'private') {
        await ctx.reply(UNKNOWN_DM_REPLY);
      }
      return;
    }

    const scopeId = await resolveScopeId(ctx, userId, policy);
    if (!scopeId) return;

    if (!fileMemory.enabled) {
      await writeLog({
        ts: now().toISOString(),
        type: 'file.upload',
        data: {
          stage: 'validation_failed',
          uploadId,
          chatId: ctx.chat.id,
          userId,
          scopeId,
          reason: 'file_memory_disabled',
          durationMs: elapsedMs(),
        },
      });

      await ctx.reply('File memory is disabled right now.');
      return;
    }

    if (!fileMemory.uploadEnabled) {
      await writeLog({
        ts: now().toISOString(),
        type: 'file.upload',
        data: {
          stage: 'validation_failed',
          uploadId,
          chatId: ctx.chat.id,
          userId,
          scopeId,
          reason: 'upload_disabled',
          durationMs: elapsedMs(),
        },
      });

      await ctx.reply('File uploads are disabled right now.');
      return;
    }

    const filename = document.file_name?.trim() || `telegram-${document.file_unique_id}.bin`;
    const mimeType = document.mime_type?.trim() || 'application/octet-stream';
    const sizeBytes = Number(document.file_size ?? 0);

    const maxSizeBytes = fileMemory.maxFileSizeMb * 1024 * 1024;
    if (sizeBytes > maxSizeBytes) {
      await writeLog({
        ts: now().toISOString(),
        type: 'file.upload',
        data: {
          stage: 'validation_failed',
          uploadId,
          chatId: ctx.chat.id,
          userId,
          scopeId,
          reason: 'metadata_size_exceeded',
          filename,
          mimeType,
          sizeBytes,
          maxSizeBytes,
          durationMs: elapsedMs(),
        },
      });

      await ctx.reply(`That file is too large. Max allowed is ${fileMemory.maxFileSizeMb} MB.`);
      return;
    }

    if (!isAllowedExtension(filename, fileMemory.allowedExtensions)) {
      await writeLog({
        ts: now().toISOString(),
        type: 'file.upload',
        data: {
          stage: 'validation_failed',
          uploadId,
          chatId: ctx.chat.id,
          userId,
          scopeId,
          reason: 'extension_not_allowed',
          filename,
          mimeType,
          sizeBytes,
          allowedExtensions: [...fileMemory.allowedExtensions],
          durationMs: elapsedMs(),
        },
      });

      const allowed = fileMemory.allowedExtensions.join(', ');
      await ctx.reply(`Unsupported file type. Allowed extensions: ${allowed}.`);
      return;
    }

    await writeLog({
      ts: now().toISOString(),
      type: 'file.upload',
      data: {
        stage: 'download_started',
        uploadId,
        chatId: ctx.chat.id,
        userId,
        scopeId,
        filename,
        mimeType,
        sizeBytes,
      },
    });

    await ctx.reply(buildUploadDownloadMessage(filename));

    let downloaded: DownloadedTelegramFile;
    try {
      downloaded = await downloadTelegramFileImpl({
        ctx,
        token,
        fileId: document.file_id,
      });
    } catch (err) {
      await writeLog({
        ts: now().toISOString(),
        type: 'prime.run.error',
        data: {
          channel: 'telegram',
          userId,
          scopeId,
          action: 'file_upload',
          uploadId,
          filename,
          error: serializeError(err),
        },
      });

      await writeLog({
        ts: now().toISOString(),
        type: 'file.upload',
        data: {
          stage: 'download_failed',
          uploadId,
          chatId: ctx.chat.id,
          userId,
          scopeId,
          filename,
          mimeType,
          sizeBytes,
          durationMs: elapsedMs(),
          error: serializeError(err),
        },
      });

      await ctx.reply('Could not download that file from Telegram. Please try again.');
      return;
    }

    const downloadedSizeBytes = downloaded.bytes.byteLength;

    await writeLog({
      ts: now().toISOString(),
      type: 'file.upload',
      data: {
        stage: 'downloaded',
        uploadId,
        chatId: ctx.chat.id,
        userId,
        scopeId,
        filename,
        mimeType,
        sizeBytes,
        downloadedSizeBytes,
      },
    });

    if (downloadedSizeBytes > maxSizeBytes) {
      await writeLog({
        ts: now().toISOString(),
        type: 'file.upload',
        data: {
          stage: 'validation_failed',
          uploadId,
          chatId: ctx.chat.id,
          userId,
          scopeId,
          reason: 'downloaded_size_exceeded',
          filename,
          mimeType,
          sizeBytes,
          downloadedSizeBytes,
          maxSizeBytes,
          durationMs: elapsedMs(),
        },
      });

      await ctx.reply(`That file is too large. Max allowed is ${fileMemory.maxFileSizeMb} MB.`);
      return;
    }

    const effectiveSizeBytes = sizeBytes > 0 ? sizeBytes : downloadedSizeBytes;

    await writeLog({
      ts: now().toISOString(),
      type: 'file.upload',
      data: {
        stage: 'index_started',
        uploadId,
        chatId: ctx.chat.id,
        userId,
        scopeId,
        filename,
        mimeType,
        sizeBytes: effectiveSizeBytes,
        maxFilesPerScope: fileMemory.maxFilesPerScope,
        pollIntervalMs: fileMemory.pollIntervalMs,
      },
    });

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
            action: 'file_upload',
            uploadId,
            filename,
            error: {
              name: 'FileMemoryIndexError',
              message: result.message,
            },
          },
        });

        await writeLog({
          ts: now().toISOString(),
          type: 'file.upload',
          data: {
            stage: 'index_failed',
            uploadId,
            chatId: ctx.chat.id,
            userId,
            scopeId,
            filename,
            mimeType,
            sizeBytes: effectiveSizeBytes,
            durationMs: elapsedMs(),
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
          uploadId,
          filename: result.filename,
        },
      });

      await writeLog({
        ts: now().toISOString(),
        type: 'file.upload',
        data: {
          stage: 'completed',
          uploadId,
          chatId: ctx.chat.id,
          userId,
          scopeId,
          filename: result.filename,
          mimeType,
          sizeBytes: effectiveSizeBytes,
          durationMs: elapsedMs(),
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
          action: 'file_upload',
          uploadId,
          filename,
          error: serializeError(err),
        },
      });

      await writeLog({
        ts: now().toISOString(),
        type: 'file.upload',
        data: {
          stage: 'index_failed',
          uploadId,
          chatId: ctx.chat.id,
          userId,
          scopeId,
          filename,
          mimeType,
          sizeBytes: effectiveSizeBytes,
          durationMs: elapsedMs(),
          error: serializeError(err),
        },
      });

      await ctx.reply('Could not index that file right now. Please try again.');
    }
  });

  bot.on('message:photo', async (ctx) => {
    const photoSizes = ctx.message.photo;
    if (!photoSizes || photoSizes.length === 0) return;

    const userId = String(ctx.from?.id ?? 'unknown');
    const largestPhoto = getLargestPhotoSize(photoSizes);
    const uploadId = `${ctx.chat.id}:${ctx.message.message_id}:${largestPhoto.file_unique_id}`;

    await writeLog({
      ts: now().toISOString(),
      type: 'telegram.update',
      data: {
        chatId: ctx.chat.id,
        userId,
        messageId: ctx.message.message_id,
        photoCount: photoSizes.length,
        fileId: largestPhoto.file_id,
        fileUniqueId: largestPhoto.file_unique_id,
        sizeBytes: largestPhoto.file_size ?? null,
        width: largestPhoto.width,
        height: largestPhoto.height,
      },
    });
    await handleVisionMessage(ctx, {
      source: 'photo',
      uploadId,
      fileId: largestPhoto.file_id,
      fileUniqueId: largestPhoto.file_unique_id,
      filename: undefined,
      mimeType: undefined,
      declaredSizeBytes: largestPhoto.file_size,
      caption: ctx.message.caption,
      width: largestPhoto.width,
      height: largestPhoto.height,
    });
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
