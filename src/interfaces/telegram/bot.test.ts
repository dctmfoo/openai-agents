import { describe, expect, it, vi } from 'vitest';

import {
  createTelegramAdapter,
  UNKNOWN_DM_REPLY,
  type TelegramBotLike,
  type TelegramContext,
} from './bot.js';
import type { FileMemoryConfig } from '../../runtime/haloConfig.js';

type HandlerBag = {
  messageText?: (ctx: TelegramContext) => Promise<void> | void;
  messageDocument?: (ctx: TelegramContext) => Promise<void> | void;
  error?: (err: unknown) => Promise<void> | void;
};

type FakeBot = TelegramBotLike & {
  handlers: HandlerBag;
  start: ReturnType<typeof vi.fn>;
};

const makeFakeBot = (): FakeBot => {
  const handlers: HandlerBag = {};

  return {
    handlers,
    on: (event, handler) => {
      if (event === 'message:text') {
        handlers.messageText = handler;
      }
      if (event === 'message:document') {
        handlers.messageDocument = handler;
      }
    },
    catch: (handler) => {
      handlers.error = handler;
    },
    start: vi.fn().mockResolvedValue(undefined),
  };
};

const fileMemoryConfig: FileMemoryConfig = {
  enabled: true,
  uploadEnabled: true,
  maxFileSizeMb: 20,
  allowedExtensions: ['pdf', 'txt', 'md'],
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

describe('telegram adapter', () => {
  const familyConfig = {
    schemaVersion: 1,
    familyId: 'default',
    members: [
      {
        memberId: 'wags',
        displayName: 'Wags',
        role: 'parent',
        telegramUserIds: [456],
      },
      {
        memberId: 'kid',
        displayName: 'Kid',
        role: 'child',
        ageGroup: 'child',
        telegramUserIds: [999],
      },
    ],
    parentsGroup: {
      telegramChatId: 777,
    },
  };

  it('runs Prime for allowed private messages and replies with output', async () => {
    const bot = makeFakeBot();
    const appendJsonl = vi.fn().mockResolvedValue(undefined);
    const appendDailyNote = vi.fn().mockResolvedValue('memory/2026-02-02.md');
    const runPrime = vi.fn().mockResolvedValue({ finalOutput: 'hi there' });
    const loadFamilyConfig = vi.fn().mockResolvedValue(familyConfig);
    const getScopeVectorStoreId = vi.fn().mockResolvedValue('vs_123');
    const now = () => new Date('2026-02-02T00:00:00.000Z');

    createTelegramAdapter({
      token: 'token',
      logDir: 'logs',
      rootDir: '/root',
      bot,
      now,
      fileMemory: fileMemoryConfig,
      deps: {
        appendJsonl,
        appendScopedDailyNote: appendDailyNote,
        runPrime,
        loadFamilyConfig,
        getScopeVectorStoreId,
      },
    });

    const reply = vi.fn().mockResolvedValue(undefined);
    const ctx: TelegramContext = {
      chat: { id: 123, type: 'private' },
      message: { text: ' hello ', message_id: 7 },
      from: { id: 456 },
      reply,
    };

    const handler = bot.handlers.messageText;
    if (!handler) throw new Error('message handler not registered');

    await handler(ctx);

    expect(runPrime).toHaveBeenCalledWith('hello', {
      channel: 'telegram',
      userId: '456',
      scopeId: 'telegram:dm:wags',
      rootDir: '/root',
      role: 'parent',
      ageGroup: undefined,
      scopeType: 'dm',
      fileSearchEnabled: true,
      fileSearchVectorStoreId: 'vs_123',
      fileSearchIncludeResults: false,
      fileSearchMaxNumResults: 5,
    });
    expect(appendDailyNote).toHaveBeenCalledWith({ rootDir: '/root', scopeId: 'telegram:dm:wags' }, '[user] hello');
    expect(appendDailyNote).toHaveBeenCalledWith({ rootDir: '/root', scopeId: 'telegram:dm:wags' }, '[prime] hi there');
    expect(reply).toHaveBeenCalledWith('hi there');

    expect(appendJsonl).toHaveBeenCalledTimes(3);
    const [logPath, firstRecord] = appendJsonl.mock.calls[0];
    expect(logPath).toBe('logs/events.jsonl');
    expect(firstRecord.type).toBe('telegram.update');
  });

  it('uploads documents when file memory upload is enabled', async () => {
    const bot = makeFakeBot();
    const appendJsonl = vi.fn().mockResolvedValue(undefined);
    const appendDailyNote = vi.fn().mockResolvedValue('memory/2026-02-02.md');
    const runPrime = vi.fn().mockResolvedValue({ finalOutput: 'ignored' });
    const loadFamilyConfig = vi.fn().mockResolvedValue(familyConfig);
    const downloadTelegramFile = vi.fn().mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
    });
    const indexTelegramDocument = vi.fn().mockResolvedValue({
      ok: true,
      filename: 'report.pdf',
    });

    createTelegramAdapter({
      token: 'token',
      bot,
      rootDir: '/root',
      fileMemory: fileMemoryConfig,
      deps: {
        appendJsonl,
        appendScopedDailyNote: appendDailyNote,
        runPrime,
        loadFamilyConfig,
        downloadTelegramFile,
        indexTelegramDocument,
      },
    });

    const reply = vi.fn().mockResolvedValue(undefined);
    const ctx: TelegramContext = {
      chat: { id: 123, type: 'private' },
      message: {
        message_id: 7,
        document: {
          file_id: 'telegram-file-1',
          file_unique_id: 'telegram-unique-1',
          file_name: 'report.pdf',
          mime_type: 'application/pdf',
          file_size: 1024,
        },
      },
      from: { id: 456 },
      reply,
    };

    const handler = bot.handlers.messageDocument;
    if (!handler) throw new Error('document handler not registered');

    await handler(ctx);

    expect(downloadTelegramFile).toHaveBeenCalledWith(ctx, 'token');
    expect(indexTelegramDocument).toHaveBeenCalledWith({
      rootDir: '/root',
      scopeId: 'telegram:dm:wags',
      uploadedBy: 'wags',
      telegramFileId: 'telegram-file-1',
      telegramFileUniqueId: 'telegram-unique-1',
      filename: 'report.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      bytes: new Uint8Array([1, 2, 3]),
      maxFilesPerScope: 200,
      pollIntervalMs: 1500,
    });
    expect(reply).toHaveBeenNthCalledWith(1, 'Got it. Downloading report.pdf from Telegram…');
    expect(reply).toHaveBeenNthCalledWith(
      2,
      "Downloaded report.pdf. Indexing it now — I'll confirm when search is ready.",
    );
    expect(reply).toHaveBeenNthCalledWith(
      3,
      'Uploaded report.pdf. It is now searchable in this chat.',
    );
    expect(runPrime).not.toHaveBeenCalled();
    expect(appendDailyNote).not.toHaveBeenCalled();
  });

  it('reports indexing failures with a friendly hint', async () => {
    const bot = makeFakeBot();
    const appendJsonl = vi.fn().mockResolvedValue(undefined);
    const appendDailyNote = vi.fn().mockResolvedValue('memory/2026-02-02.md');
    const runPrime = vi.fn().mockResolvedValue({ finalOutput: 'ignored' });
    const loadFamilyConfig = vi.fn().mockResolvedValue(familyConfig);
    const downloadTelegramFile = vi.fn().mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
    });
    const indexTelegramDocument = vi.fn().mockResolvedValue({
      ok: false,
      message: 'File memory limit reached for this chat.',
    });

    createTelegramAdapter({
      token: 'token',
      bot,
      rootDir: '/root',
      fileMemory: fileMemoryConfig,
      deps: {
        appendJsonl,
        appendScopedDailyNote: appendDailyNote,
        runPrime,
        loadFamilyConfig,
        downloadTelegramFile,
        indexTelegramDocument,
      },
    });

    const reply = vi.fn().mockResolvedValue(undefined);
    const ctx: TelegramContext = {
      chat: { id: 123, type: 'private' },
      message: {
        message_id: 7,
        document: {
          file_id: 'telegram-file-1',
          file_unique_id: 'telegram-unique-1',
          file_name: 'report.pdf',
          mime_type: 'application/pdf',
          file_size: 1024,
        },
      },
      from: { id: 456 },
      reply,
    };

    const handler = bot.handlers.messageDocument;
    if (!handler) throw new Error('document handler not registered');

    await handler(ctx);

    expect(reply).toHaveBeenNthCalledWith(1, 'Got it. Downloading report.pdf from Telegram…');
    expect(reply).toHaveBeenNthCalledWith(
      2,
      "Downloaded report.pdf. Indexing it now — I'll confirm when search is ready.",
    );
    expect(reply).toHaveBeenNthCalledWith(
      3,
      'File memory limit reached for this chat. Delete older uploaded files from admin and retry.',
    );
    expect(runPrime).not.toHaveBeenCalled();
    expect(appendDailyNote).not.toHaveBeenCalled();
  });

  it('rejects document uploads when downloaded size exceeds limit', async () => {
    const bot = makeFakeBot();
    const appendJsonl = vi.fn().mockResolvedValue(undefined);
    const appendDailyNote = vi.fn().mockResolvedValue('memory/2026-02-02.md');
    const runPrime = vi.fn().mockResolvedValue({ finalOutput: 'ignored' });
    const loadFamilyConfig = vi.fn().mockResolvedValue(familyConfig);
    const downloadTelegramFile = vi.fn().mockResolvedValue({
      bytes: new Uint8Array(2 * 1024 * 1024),
    });
    const indexTelegramDocument = vi.fn().mockResolvedValue({
      ok: true,
      filename: 'report.pdf',
    });

    createTelegramAdapter({
      token: 'token',
      bot,
      fileMemory: {
        ...fileMemoryConfig,
        maxFileSizeMb: 1,
      },
      deps: {
        appendJsonl,
        appendScopedDailyNote: appendDailyNote,
        runPrime,
        loadFamilyConfig,
        downloadTelegramFile,
        indexTelegramDocument,
      },
    });

    const reply = vi.fn().mockResolvedValue(undefined);
    const ctx: TelegramContext = {
      chat: { id: 123, type: 'private' },
      message: {
        message_id: 7,
        document: {
          file_id: 'telegram-file-1',
          file_unique_id: 'telegram-unique-1',
          file_name: 'report.pdf',
          mime_type: 'application/pdf',
          file_size: 128,
        },
      },
      from: { id: 456 },
      reply,
    };

    const handler = bot.handlers.messageDocument;
    if (!handler) throw new Error('document handler not registered');

    await handler(ctx);

    expect(reply).toHaveBeenNthCalledWith(1, 'Got it. Downloading report.pdf from Telegram…');
    expect(reply).toHaveBeenNthCalledWith(2, 'That file is too large. Max allowed is 1 MB.');
    expect(downloadTelegramFile).toHaveBeenCalledTimes(1);
    expect(indexTelegramDocument).not.toHaveBeenCalled();
  });

  it('rejects document uploads when upload is disabled', async () => {
    const bot = makeFakeBot();
    const appendJsonl = vi.fn().mockResolvedValue(undefined);
    const appendDailyNote = vi.fn().mockResolvedValue('memory/2026-02-02.md');
    const runPrime = vi.fn().mockResolvedValue({ finalOutput: 'ignored' });
    const loadFamilyConfig = vi.fn().mockResolvedValue(familyConfig);
    const downloadTelegramFile = vi.fn().mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
    });
    const indexTelegramDocument = vi.fn().mockResolvedValue({
      ok: true,
      filename: 'report.pdf',
    });

    createTelegramAdapter({
      token: 'token',
      bot,
      fileMemory: {
        ...fileMemoryConfig,
        uploadEnabled: false,
      },
      deps: {
        appendJsonl,
        appendScopedDailyNote: appendDailyNote,
        runPrime,
        loadFamilyConfig,
        downloadTelegramFile,
        indexTelegramDocument,
      },
    });

    const reply = vi.fn().mockResolvedValue(undefined);
    const ctx: TelegramContext = {
      chat: { id: 123, type: 'private' },
      message: {
        message_id: 7,
        document: {
          file_id: 'telegram-file-1',
          file_unique_id: 'telegram-unique-1',
          file_name: 'report.pdf',
          mime_type: 'application/pdf',
          file_size: 1024,
        },
      },
      from: { id: 456 },
      reply,
    };

    const handler = bot.handlers.messageDocument;
    if (!handler) throw new Error('document handler not registered');

    await handler(ctx);

    expect(reply).toHaveBeenCalledWith('File uploads are disabled right now.');
    expect(downloadTelegramFile).not.toHaveBeenCalled();
    expect(indexTelegramDocument).not.toHaveBeenCalled();
    expect(runPrime).not.toHaveBeenCalled();
    expect(appendDailyNote).not.toHaveBeenCalled();
  });

  it('refuses unknown private messages without running Prime', async () => {
    const bot = makeFakeBot();
    const appendJsonl = vi.fn().mockResolvedValue(undefined);
    const appendDailyNote = vi.fn().mockResolvedValue('memory/2026-02-02.md');
    const runPrime = vi.fn().mockResolvedValue({ finalOutput: 'ignored' });
    const loadFamilyConfig = vi.fn().mockResolvedValue(familyConfig);

    createTelegramAdapter({
      token: 'token',
      bot,
      deps: { appendJsonl, appendScopedDailyNote: appendDailyNote, runPrime, loadFamilyConfig },
    });

    const reply = vi.fn().mockResolvedValue(undefined);
    const ctx: TelegramContext = {
      chat: { id: 1, type: 'private' },
      message: { text: 'hello', message_id: 1 },
      from: { id: 222 },
      reply,
    };

    const handler = bot.handlers.messageText;
    if (!handler) throw new Error('message handler not registered');

    await handler(ctx);

    expect(runPrime).not.toHaveBeenCalled();
    expect(appendDailyNote).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(UNKNOWN_DM_REPLY);
  });

  it('denies unapproved group chats', async () => {
    const bot = makeFakeBot();
    const appendJsonl = vi.fn().mockResolvedValue(undefined);
    const appendDailyNote = vi.fn().mockResolvedValue('memory/2026-02-02.md');
    const runPrime = vi.fn().mockResolvedValue({ finalOutput: 'ignored' });
    const loadFamilyConfig = vi.fn().mockResolvedValue(familyConfig);

    createTelegramAdapter({
      token: 'token',
      bot,
      deps: { appendJsonl, appendScopedDailyNote: appendDailyNote, runPrime, loadFamilyConfig },
    });

    const reply = vi.fn().mockResolvedValue(undefined);
    const ctx: TelegramContext = {
      chat: { id: 1234, type: 'group' },
      message: { text: 'hello', message_id: 1 },
      from: { id: 456 },
      reply,
    };

    const handler = bot.handlers.messageText;
    if (!handler) throw new Error('message handler not registered');

    await handler(ctx);

    expect(runPrime).not.toHaveBeenCalled();
    expect(appendDailyNote).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });
});
