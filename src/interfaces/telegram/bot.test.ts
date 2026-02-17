import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

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
  messagePhoto?: (ctx: TelegramContext) => Promise<void> | void;
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
      if (event === 'message:photo') {
        handlers.messagePhoto = handler;
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

    expect(downloadTelegramFile).toHaveBeenCalledWith({
      ctx,
      token: 'token',
      fileId: 'telegram-file-1',
    });
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

    const fileUploadStages = appendJsonl.mock.calls
      .map(([, record]) => record)
      .filter((record): record is { type: 'file.upload'; data: { stage?: string } } => record.type === 'file.upload')
      .map((record) => record.data.stage ?? '');

    expect(fileUploadStages).toEqual(
      expect.arrayContaining([
        'received',
        'download_started',
        'downloaded',
        'index_started',
        'completed',
      ]),
    );

    expect(runPrime).not.toHaveBeenCalled();
    expect(appendDailyNote).not.toHaveBeenCalled();
  });

  it('routes photo uploads to vision and stores them in scoped image memory', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'telegram-vision-photo-'));
    const bot = makeFakeBot();
    const appendJsonl = vi.fn().mockResolvedValue(undefined);
    const appendDailyNote = vi.fn().mockResolvedValue('memory/2026-02-02.md');
    const runPrime = vi.fn().mockResolvedValue({ finalOutput: 'looks like a sunset' });
    const loadFamilyConfig = vi.fn().mockResolvedValue(familyConfig);
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47,
      0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d,
    ]);
    const downloadTelegramFile = vi.fn().mockResolvedValue({
      bytes: pngBytes,
      filePath: 'photos/photo-large.png',
    });
    const indexTelegramDocument = vi.fn().mockResolvedValue({
      ok: true,
      filename: 'photo.jpg',
    });

    createTelegramAdapter({
      token: 'token',
      bot,
      rootDir,
      fileMemory: {
        ...fileMemoryConfig,
        enabled: false,
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
        message_id: 8,
        caption: 'what do you see?',
        photo: [
          {
            file_id: 'photo-small',
            file_unique_id: 'photo-unique-small',
            width: 320,
            height: 240,
            file_size: 2048,
          },
          {
            file_id: 'photo-large',
            file_unique_id: 'photo-unique-large',
            width: 1920,
            height: 1080,
            file_size: 4096,
          },
        ],
      },
      from: { id: 456 },
      reply,
    };

    const handler = bot.handlers.messagePhoto;
    if (!handler) throw new Error('photo handler not registered');

    await handler(ctx);

    expect(downloadTelegramFile).toHaveBeenCalledWith({
      ctx,
      token: 'token',
      fileId: 'photo-large',
    });
    expect(indexTelegramDocument).not.toHaveBeenCalled();
    expect(runPrime).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith('looks like a sunset');

    const [primeInput, primeOptions] = runPrime.mock.calls[0];
    expect(Array.isArray(primeInput)).toBe(true);
    const userMessage = (primeInput as Array<{ role: string; content: unknown }>)[0];
    expect(userMessage.role).toBe('user');
    if (!Array.isArray(userMessage.content)) {
      throw new Error('expected structured user content');
    }
    expect(userMessage.content[0]).toEqual({
      type: 'input_text',
      text: 'what do you see?',
    });
    expect(userMessage.content[1]).toEqual(
      expect.objectContaining({
        type: 'input_image',
        detail: 'auto',
      }),
    );
    const imageItem = userMessage.content[1];
    const imageSource = (imageItem as { image?: unknown }).image;
    expect(typeof imageSource).toBe('string');
    expect(String(imageSource)).toMatch(/^data:image\/png;base64,/);

    expect(primeOptions.fileSearchEnabled).toBe(false);
    expect(primeOptions.contextMode).toBe('light');
    expect(primeOptions.disableSession).toBe(true);
    expect(primeOptions.disabledToolNames).toEqual(
      expect.arrayContaining([
        'web_search_call',
        'read_scoped_memory',
        'remember_daily',
        'semantic_search',
        'file_search',
        'shell',
      ]),
    );

    const imageNoteCall = appendDailyNote.mock.calls.find(([, note]) =>
      String(note).startsWith('[user:image:photo]'),
    );
    expect(imageNoteCall).toBeDefined();

    const imageNote = String(imageNoteCall?.[1] ?? '');
    const pathMatch = /\[file:([^\]]+)\]/.exec(imageNote);
    expect(pathMatch).not.toBeNull();
    const storedRelativePath = pathMatch?.[1] ?? '';
    const stored = await readFile(path.join(rootDir, storedRelativePath));
    expect(new Uint8Array(stored)).toEqual(pngBytes);
  });

  it('routes image documents to vision even when file uploads are disabled', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'telegram-vision-doc-'));
    const bot = makeFakeBot();
    const appendJsonl = vi.fn().mockResolvedValue(undefined);
    const appendDailyNote = vi.fn().mockResolvedValue('memory/2026-02-02.md');
    const runPrime = vi.fn().mockResolvedValue({ finalOutput: 'I can see a chart.' });
    const loadFamilyConfig = vi.fn().mockResolvedValue(familyConfig);
    const downloadTelegramFile = vi.fn().mockResolvedValue({
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43]),
      filePath: 'documents/picture.jpg',
    });
    const indexTelegramDocument = vi.fn().mockResolvedValue({
      ok: true,
      filename: 'ignored.jpg',
    });

    createTelegramAdapter({
      token: 'token',
      bot,
      rootDir,
      fileMemory: {
        ...fileMemoryConfig,
        enabled: false,
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
        message_id: 9,
        caption: 'summarize this image',
        document: {
          file_id: 'telegram-file-image-1',
          file_unique_id: 'telegram-unique-image-1',
          file_name: 'photo.png',
          mime_type: 'image/png',
          file_size: 2048,
        },
      },
      from: { id: 456 },
      reply,
    };

    const handler = bot.handlers.messageDocument;
    if (!handler) throw new Error('document handler not registered');

    await handler(ctx);

    expect(downloadTelegramFile).toHaveBeenCalledWith({
      ctx,
      token: 'token',
      fileId: 'telegram-file-image-1',
    });
    expect(indexTelegramDocument).not.toHaveBeenCalled();
    expect(runPrime).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith('I can see a chart.');
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

    const fileUploadStages = appendJsonl.mock.calls
      .map(([, record]) => record)
      .filter((record): record is { type: 'file.upload'; data: { stage?: string } } => record.type === 'file.upload')
      .map((record) => record.data.stage ?? '');

    expect(fileUploadStages).toContain('index_failed');

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

  it('handles /restart for parent dm by exiting with restart code', async () => {
    const bot = makeFakeBot();
    const appendJsonl = vi.fn().mockResolvedValue(undefined);
    const appendDailyNote = vi.fn().mockResolvedValue('memory/2026-02-02.md');
    const runPrime = vi.fn().mockResolvedValue({ finalOutput: 'ignored' });
    const loadFamilyConfig = vi.fn().mockResolvedValue(familyConfig);

    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined as never) as (code?: string | number | null | undefined) => never);
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((handler: unknown) => {
      if (typeof handler === 'function') {
        handler();
      }
      return 0 as unknown as NodeJS.Timeout;
    }) as unknown as typeof setTimeout);

    createTelegramAdapter({
      token: 'token',
      bot,
      deps: { appendJsonl, appendScopedDailyNote: appendDailyNote, runPrime, loadFamilyConfig },
    });

    const reply = vi.fn().mockResolvedValue(undefined);
    const ctx: TelegramContext = {
      chat: { id: 1, type: 'private' },
      message: { text: '/restart', message_id: 1 },
      from: { id: 456 },
      reply,
    };

    const handler = bot.handlers.messageText;
    if (!handler) throw new Error('message handler not registered');

    await handler(ctx);

    expect(reply).toHaveBeenCalledWith('🔨 Building and restarting halo...');
    expect(runPrime).not.toHaveBeenCalled();
    expect(appendDailyNote).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(43);
    expect(timeoutSpy).toHaveBeenCalled();

    exitSpy.mockRestore();
    timeoutSpy.mockRestore();
  });

  it('denies /restart for child dm', async () => {
    const bot = makeFakeBot();
    const appendJsonl = vi.fn().mockResolvedValue(undefined);
    const appendDailyNote = vi.fn().mockResolvedValue('memory/2026-02-02.md');
    const runPrime = vi.fn().mockResolvedValue({ finalOutput: 'ignored' });
    const loadFamilyConfig = vi.fn().mockResolvedValue(familyConfig);

    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined as never) as (code?: string | number | null | undefined) => never);

    createTelegramAdapter({
      token: 'token',
      bot,
      deps: { appendJsonl, appendScopedDailyNote: appendDailyNote, runPrime, loadFamilyConfig },
    });

    const reply = vi.fn().mockResolvedValue(undefined);
    const ctx: TelegramContext = {
      chat: { id: 1, type: 'private' },
      message: { text: '/restart', message_id: 1 },
      from: { id: 999 },
      reply,
    };

    const handler = bot.handlers.messageText;
    if (!handler) throw new Error('message handler not registered');

    await handler(ctx);

    expect(reply).toHaveBeenCalledWith('Restart is only available in parent DMs.');
    expect(runPrime).not.toHaveBeenCalled();
    expect(appendDailyNote).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();

    exitSpy.mockRestore();
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
