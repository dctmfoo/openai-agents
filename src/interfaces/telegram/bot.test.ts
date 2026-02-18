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
  messageVoice?: (ctx: TelegramContext) => Promise<void> | void;
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
      if (event === 'message:voice') {
        handlers.messageVoice = handler;
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

  const familyConfigWithFamilyGroup = {
    ...familyConfig,
    schemaVersion: 2,
    controlPlane: {
      policyVersion: 'v2',
      activeProfileId: 'default',
      scopes: [
        {
          scopeId: 'scope-parents-group',
          scopeType: 'parents_group',
          telegramChatId: 777,
        },
        {
          scopeId: 'scope-family-group',
          scopeType: 'family_group',
          telegramChatId: 888,
        },
      ],
      capabilityTiers: {},
      memoryLanePolicies: {},
      modelPolicies: {},
      safetyPolicies: {},
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
      allowedMemoryReadLanes: ['family_shared', 'parent_private:wags', 'parents_shared'],
      allowedMemoryReadScopes: ['telegram:dm:wags'],
    });
    expect(appendDailyNote).toHaveBeenCalledWith({ rootDir: '/root', scopeId: 'telegram:dm:wags' }, '[user] hello');
    expect(appendDailyNote).toHaveBeenCalledWith({ rootDir: '/root', scopeId: 'telegram:dm:wags' }, '[prime] hi there');
    expect(reply).toHaveBeenCalledWith('hi there');

    expect(appendJsonl).toHaveBeenCalledTimes(3);
    const [logPath, firstRecord] = appendJsonl.mock.calls[0];
    expect(logPath).toBe('logs/events.jsonl');
    expect(firstRecord.type).toBe('telegram.update');
  });

  it('disables file_search when lane guard blocks all scoped files', async () => {
    const bot = makeFakeBot();
    const appendJsonl = vi.fn().mockResolvedValue(undefined);
    const appendDailyNote = vi.fn().mockResolvedValue('memory/2026-02-02.md');
    const runPrime = vi.fn().mockResolvedValue({ finalOutput: 'safe response' });
    const loadFamilyConfig = vi.fn().mockResolvedValue(familyConfig);
    const getScopeVectorStoreId = vi.fn().mockResolvedValue('vs_123');
    const readScopeFileRegistry = vi.fn().mockResolvedValue({
      scopeId: 'telegram:dm:wags',
      vectorStoreId: 'vs_123',
      createdAtMs: 1,
      updatedAtMs: 1,
      files: [
        {
          telegramFileId: 'telegram-file-1',
          telegramFileUniqueId: 'telegram-unique-1',
          filename: 'kid-notes.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 42,
          openaiFileId: 'file_1',
          vectorStoreFileId: 'vsfile_1',
          status: 'completed',
          lastError: null,
          uploadedBy: 'kid',
          uploadedAtMs: 1,
          storageMetadata: {
            laneId: 'child_private:kid',
            ownerMemberId: 'kid',
            scopeId: 'telegram:dm:wags',
            policyVersion: 'v2',
            artifactType: 'document',
            visibilityClass: 'private',
          },
        },
      ],
    });

    createTelegramAdapter({
      token: 'token',
      rootDir: '/root',
      bot,
      fileMemory: fileMemoryConfig,
      deps: {
        appendJsonl,
        appendScopedDailyNote: appendDailyNote,
        runPrime,
        loadFamilyConfig,
        getScopeVectorStoreId,
        readScopeFileRegistry,
      },
    });

    const reply = vi.fn().mockResolvedValue(undefined);
    const ctx: TelegramContext = {
      chat: { id: 123, type: 'private' },
      message: { text: 'hello', message_id: 8 },
      from: { id: 456 },
      reply,
    };

    const handler = bot.handlers.messageText;
    if (!handler) throw new Error('message handler not registered');

    await handler(ctx);

    expect(runPrime).toHaveBeenCalledWith(
      'hello',
      expect.objectContaining({
        fileSearchEnabled: false,
        fileSearchVectorStoreId: undefined,
        allowedMemoryReadScopes: ['telegram:dm:wags'],
      }),
    );
  });

  it('runs Prime for mentioned family-group messages', async () => {
    const bot = makeFakeBot();
    const appendJsonl = vi.fn().mockResolvedValue(undefined);
    const appendDailyNote = vi.fn().mockResolvedValue('memory/2026-02-02.md');
    const runPrime = vi.fn().mockResolvedValue({ finalOutput: 'group-safe reply' });
    const loadFamilyConfig = vi.fn().mockResolvedValue(familyConfigWithFamilyGroup);

    createTelegramAdapter({
      token: 'token',
      rootDir: '/root',
      bot,
      deps: {
        appendJsonl,
        appendScopedDailyNote: appendDailyNote,
        runPrime,
        loadFamilyConfig,
      },
    });

    const reply = vi.fn().mockResolvedValue(undefined);
    const ctx: TelegramContext = {
      chat: { id: 888, type: 'group' },
      message: { text: '@halo quick summary please', message_id: 42 },
      from: { id: 456 },
      reply,
    };

    const handler = bot.handlers.messageText;
    if (!handler) throw new Error('message handler not registered');

    await handler(ctx);

    expect(runPrime).toHaveBeenCalledWith(
      '@halo quick summary please',
      expect.objectContaining({
        channel: 'telegram',
        userId: '456',
        scopeId: 'telegram:family_group:888',
        rootDir: '/root',
        role: 'parent',
        scopeType: undefined,
        fileSearchEnabled: false,
        allowedMemoryReadLanes: ['family_shared'],
      }),
    );
    expect(reply).toHaveBeenCalledWith('group-safe reply');
  });

  it('does not run Prime for unmentioned family-group messages', async () => {
    const bot = makeFakeBot();
    const appendJsonl = vi.fn().mockResolvedValue(undefined);
    const appendDailyNote = vi.fn().mockResolvedValue('memory/2026-02-02.md');
    const runPrime = vi.fn().mockResolvedValue({ finalOutput: 'ignored' });
    const loadFamilyConfig = vi.fn().mockResolvedValue(familyConfigWithFamilyGroup);

    createTelegramAdapter({
      token: 'token',
      rootDir: '/root',
      bot,
      deps: {
        appendJsonl,
        appendScopedDailyNote: appendDailyNote,
        runPrime,
        loadFamilyConfig,
      },
    });

    const reply = vi.fn().mockResolvedValue(undefined);
    const ctx: TelegramContext = {
      chat: { id: 888, type: 'group' },
      message: { text: 'quick summary please', message_id: 43 },
      from: { id: 456 },
      reply,
    };

    const handler = bot.handlers.messageText;
    if (!handler) throw new Error('message handler not registered');

    await handler(ctx);

    expect(runPrime).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
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
      laneId: 'parent_private:wags',
      policyVersion: 'legacy-v1',
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

  it('transcribes voice notes and runs the normal policy path', async () => {
    const bot = makeFakeBot();
    const appendJsonl = vi.fn().mockResolvedValue(undefined);
    const appendDailyNote = vi.fn().mockResolvedValue('memory/2026-02-02.md');
    const runPrime = vi.fn().mockResolvedValue({ finalOutput: 'voice reply' });
    const loadFamilyConfig = vi.fn().mockResolvedValue(familyConfig);
    const getScopeVectorStoreId = vi.fn().mockResolvedValue('vs_123');
    const downloadTelegramFile = vi.fn().mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      filePath: 'voice/file.ogg',
    });
    const transcribeVoiceNote = vi.fn().mockResolvedValue('hello from voice note');

    createTelegramAdapter({
      token: 'token',
      rootDir: '/root',
      bot,
      fileMemory: fileMemoryConfig,
      deps: {
        appendJsonl,
        appendScopedDailyNote: appendDailyNote,
        runPrime,
        loadFamilyConfig,
        getScopeVectorStoreId,
        downloadTelegramFile,
        transcribeVoiceNote,
      },
    });

    const reply = vi.fn().mockResolvedValue(undefined);
    const ctx: TelegramContext = {
      chat: { id: 123, type: 'private' },
      message: {
        message_id: 12,
        voice: {
          file_id: 'voice-file-1',
          file_unique_id: 'voice-unique-1',
          duration: 4,
          mime_type: 'audio/ogg',
          file_size: 1200,
        },
      },
      from: { id: 456 },
      reply,
    };

    const handler = bot.handlers.messageVoice;
    if (!handler) throw new Error('voice handler not registered');

    await handler(ctx);

    expect(downloadTelegramFile).toHaveBeenCalledWith({
      ctx,
      token: 'token',
      fileId: 'voice-file-1',
    });
    expect(transcribeVoiceNote).toHaveBeenCalledTimes(1);
    expect(runPrime).toHaveBeenCalledWith(
      'hello from voice note',
      expect.objectContaining({
        scopeId: 'telegram:dm:wags',
        fileSearchEnabled: true,
        allowedMemoryReadScopes: ['telegram:dm:wags'],
      }),
    );
    expect(reply).toHaveBeenCalledWith('voice reply');
  });

  it('retries failed voice transcription and falls back clearly', async () => {
    const bot = makeFakeBot();
    const appendJsonl = vi.fn().mockResolvedValue(undefined);
    const appendDailyNote = vi.fn().mockResolvedValue('memory/2026-02-02.md');
    const runPrime = vi.fn().mockResolvedValue({ finalOutput: 'voice reply' });
    const loadFamilyConfig = vi.fn().mockResolvedValue(familyConfig);
    const getScopeVectorStoreId = vi.fn().mockResolvedValue('vs_123');
    const downloadTelegramFile = vi.fn().mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      filePath: 'voice/file.ogg',
    });
    const transcribeVoiceNote = vi.fn().mockRejectedValue(new Error('transcription unavailable'));

    createTelegramAdapter({
      token: 'token',
      rootDir: '/root',
      bot,
      fileMemory: fileMemoryConfig,
      deps: {
        appendJsonl,
        appendScopedDailyNote: appendDailyNote,
        runPrime,
        loadFamilyConfig,
        getScopeVectorStoreId,
        downloadTelegramFile,
        transcribeVoiceNote,
      },
    });

    const reply = vi.fn().mockResolvedValue(undefined);
    const ctx: TelegramContext = {
      chat: { id: 123, type: 'private' },
      message: {
        message_id: 13,
        voice: {
          file_id: 'voice-file-2',
          file_unique_id: 'voice-unique-2',
          duration: 4,
          mime_type: 'audio/ogg',
          file_size: 1200,
        },
      },
      from: { id: 456 },
      reply,
    };

    const handler = bot.handlers.messageVoice;
    if (!handler) throw new Error('voice handler not registered');

    await handler(ctx);

    expect(transcribeVoiceNote).toHaveBeenCalledTimes(3);
    expect(runPrime).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(
      'I couldn\'t transcribe that voice note right now. Please type your message or try another voice note.',
    );
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

    const eventTypes = appendJsonl.mock.calls.map(([, record]) => record.type);
    expect(eventTypes).toContain('telegram.restart');
    expect(eventTypes).not.toContain('prime.run.success');

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

  it('handles /onboard join spouse in parent dm with deterministic onboarding flow', async () => {
    const bot = makeFakeBot();
    const appendJsonl = vi.fn().mockResolvedValue(undefined);
    const appendDailyNote = vi.fn().mockResolvedValue('memory/2026-02-02.md');
    const runPrime = vi.fn().mockResolvedValue({ finalOutput: 'ignored' });
    const loadFamilyConfig = vi.fn().mockResolvedValue(familyConfig);
    const bootstrapParentOnboarding = vi.fn().mockResolvedValue({
      outcome: 'already_bootstrapped',
      onboarding: {
        household: {
          householdId: 'household-default',
          displayName: 'Default household',
          ownerMemberId: 'wags',
          createdAt: '2026-02-17T10:00:00.000Z',
        },
        memberLinks: [
          {
            memberId: 'wags',
            role: 'parent',
            profileId: 'parent_default',
            telegramUserId: 456,
            linkedAt: '2026-02-17T10:00:00.000Z',
            linkedByMemberId: 'wags',
          },
        ],
        invites: [
          {
            inviteId: 'invite-parent-spouse_1-2002',
            householdId: 'household-default',
            role: 'parent',
            profileId: 'parent_default',
            issuedByMemberId: 'wags',
            issuedAt: '2026-02-17T10:00:00.000Z',
            expiresAt: '2026-02-24T10:00:00.000Z',
            state: 'accepted',
            acceptedAt: '2026-02-17T10:00:00.000Z',
            acceptedByMemberId: 'spouse_1',
            acceptedTelegramUserId: 2002,
          },
        ],
        relinks: [],
        scopeTerminology: {
          dm: 'member DM',
          parentsGroup: 'parents group',
          familyGroup: 'family group',
        },
      },
    });
    const issueOnboardingInvite = vi.fn().mockResolvedValue({
      outcome: 'issued',
      onboarding: {
        household: {
          householdId: 'household-default',
          displayName: 'Default household',
          ownerMemberId: 'wags',
          createdAt: '2026-02-17T10:00:00.000Z',
        },
        memberLinks: [
          {
            memberId: 'wags',
            role: 'parent',
            profileId: 'parent_default',
            telegramUserId: 456,
            linkedAt: '2026-02-17T10:00:00.000Z',
            linkedByMemberId: 'wags',
          },
        ],
        invites: [
          {
            inviteId: 'invite-parent-spouse_1-2002',
            householdId: 'household-default',
            role: 'parent',
            profileId: 'parent_default',
            issuedByMemberId: 'wags',
            issuedAt: '2026-02-17T10:00:00.000Z',
            expiresAt: '2026-02-24T10:00:00.000Z',
            state: 'issued',
          },
        ],
        relinks: [],
        scopeTerminology: {
          dm: 'member DM',
          parentsGroup: 'parents group',
          familyGroup: 'family group',
        },
      },
    });
    const acceptOnboardingInvite = vi.fn().mockResolvedValue({
      outcome: 'joined',
      onboarding: {
        household: {
          householdId: 'household-default',
          displayName: 'Default household',
          ownerMemberId: 'wags',
          createdAt: '2026-02-17T10:00:00.000Z',
        },
        memberLinks: [
          {
            memberId: 'wags',
            role: 'parent',
            profileId: 'parent_default',
            telegramUserId: 456,
            linkedAt: '2026-02-17T10:00:00.000Z',
            linkedByMemberId: 'wags',
          },
          {
            memberId: 'spouse_1',
            role: 'parent',
            profileId: 'parent_default',
            telegramUserId: 2002,
            linkedAt: '2026-02-17T10:00:00.000Z',
            linkedByMemberId: 'wags',
          },
        ],
        invites: [
          {
            inviteId: 'invite-parent-spouse_1-2002',
            householdId: 'household-default',
            role: 'parent',
            profileId: 'parent_default',
            issuedByMemberId: 'wags',
            issuedAt: '2026-02-17T10:00:00.000Z',
            expiresAt: '2026-02-24T10:00:00.000Z',
            state: 'accepted',
            acceptedAt: '2026-02-17T10:00:00.000Z',
            acceptedByMemberId: 'spouse_1',
            acceptedTelegramUserId: 2002,
          },
        ],
        relinks: [],
        scopeTerminology: {
          dm: 'member DM',
          parentsGroup: 'parents group',
          familyGroup: 'family group',
        },
      },
    });

    createTelegramAdapter({
      token: 'token',
      bot,
      haloHome: '/tmp/halo-onboard-spouse',
      now: () => new Date('2026-02-17T10:00:00.000Z'),
      deps: {
        appendJsonl,
        appendScopedDailyNote: appendDailyNote,
        runPrime,
        loadFamilyConfig,
        bootstrapParentOnboarding,
        issueOnboardingInvite,
        acceptOnboardingInvite,
      },
    });

    const reply = vi.fn().mockResolvedValue(undefined);
    const ctx: TelegramContext = {
      chat: { id: 1, type: 'private' },
      message: { text: '/onboard join spouse spouse_1 Spouse 2002', message_id: 1 },
      from: { id: 456 },
      reply,
    };

    const handler = bot.handlers.messageText;
    if (!handler) throw new Error('message handler not registered');

    await handler(ctx);

    expect(bootstrapParentOnboarding).toHaveBeenCalledWith(
      expect.objectContaining({
        haloHome: '/tmp/halo-onboard-spouse',
        ownerMemberId: 'wags',
        ownerTelegramUserId: 456,
      }),
    );
    expect(issueOnboardingInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        haloHome: '/tmp/halo-onboard-spouse',
        inviteId: 'invite-parent-spouse_1-2002',
        issuedByMemberId: 'wags',
        role: 'parent',
        profileId: 'parent_default',
      }),
    );
    expect(acceptOnboardingInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        haloHome: '/tmp/halo-onboard-spouse',
        inviteId: 'invite-parent-spouse_1-2002',
        memberId: 'spouse_1',
        displayName: 'Spouse',
        telegramUserId: 2002,
        linkedByMemberId: 'wags',
      }),
    );
    expect(reply).toHaveBeenCalledWith(
      'Onboarding join completed: spouse_1 joined as parent (joined).',
    );
    expect(runPrime).not.toHaveBeenCalled();
    expect(appendDailyNote).not.toHaveBeenCalled();
  });

  it('handles /onboard join child with role-safe child defaults', async () => {
    const bot = makeFakeBot();
    const appendJsonl = vi.fn().mockResolvedValue(undefined);
    const appendDailyNote = vi.fn().mockResolvedValue('memory/2026-02-02.md');
    const runPrime = vi.fn().mockResolvedValue({ finalOutput: 'ignored' });
    const loadFamilyConfig = vi.fn().mockResolvedValue(familyConfig);
    const bootstrapParentOnboarding = vi.fn().mockResolvedValue({
      outcome: 'already_bootstrapped',
      onboarding: {
        household: {
          householdId: 'household-default',
          displayName: 'Default household',
          ownerMemberId: 'wags',
          createdAt: '2026-02-17T10:00:00.000Z',
        },
        memberLinks: [
          {
            memberId: 'wags',
            role: 'parent',
            profileId: 'parent_default',
            telegramUserId: 456,
            linkedAt: '2026-02-17T10:00:00.000Z',
            linkedByMemberId: 'wags',
          },
        ],
        invites: [],
        relinks: [],
        scopeTerminology: {
          dm: 'member DM',
          parentsGroup: 'parents group',
          familyGroup: 'family group',
        },
      },
    });
    const issueOnboardingInvite = vi.fn().mockResolvedValue({
      outcome: 'issued',
      onboarding: {
        household: {
          householdId: 'household-default',
          displayName: 'Default household',
          ownerMemberId: 'wags',
          createdAt: '2026-02-17T10:00:00.000Z',
        },
        memberLinks: [
          {
            memberId: 'wags',
            role: 'parent',
            profileId: 'parent_default',
            telegramUserId: 456,
            linkedAt: '2026-02-17T10:00:00.000Z',
            linkedByMemberId: 'wags',
          },
        ],
        invites: [
          {
            inviteId: 'invite-child-kid_2-3003',
            householdId: 'household-default',
            role: 'child',
            profileId: 'young_child',
            issuedByMemberId: 'wags',
            issuedAt: '2026-02-17T10:00:00.000Z',
            expiresAt: '2026-02-24T10:00:00.000Z',
            state: 'issued',
          },
        ],
        relinks: [],
        scopeTerminology: {
          dm: 'member DM',
          parentsGroup: 'parents group',
          familyGroup: 'family group',
        },
      },
    });
    const acceptOnboardingInvite = vi.fn().mockResolvedValue({
      outcome: 'joined',
      onboarding: {
        household: {
          householdId: 'household-default',
          displayName: 'Default household',
          ownerMemberId: 'wags',
          createdAt: '2026-02-17T10:00:00.000Z',
        },
        memberLinks: [
          {
            memberId: 'wags',
            role: 'parent',
            profileId: 'parent_default',
            telegramUserId: 456,
            linkedAt: '2026-02-17T10:00:00.000Z',
            linkedByMemberId: 'wags',
          },
          {
            memberId: 'kid_2',
            role: 'child',
            profileId: 'young_child',
            telegramUserId: 3003,
            linkedAt: '2026-02-17T10:00:00.000Z',
            linkedByMemberId: 'wags',
          },
        ],
        invites: [
          {
            inviteId: 'invite-child-kid_2-3003',
            householdId: 'household-default',
            role: 'child',
            profileId: 'young_child',
            issuedByMemberId: 'wags',
            issuedAt: '2026-02-17T10:00:00.000Z',
            expiresAt: '2026-02-24T10:00:00.000Z',
            state: 'accepted',
            acceptedAt: '2026-02-17T10:00:00.000Z',
            acceptedByMemberId: 'kid_2',
            acceptedTelegramUserId: 3003,
          },
        ],
        relinks: [],
        scopeTerminology: {
          dm: 'member DM',
          parentsGroup: 'parents group',
          familyGroup: 'family group',
        },
      },
    });

    createTelegramAdapter({
      token: 'token',
      bot,
      haloHome: '/tmp/halo-onboard-child',
      now: () => new Date('2026-02-17T10:00:00.000Z'),
      deps: {
        appendJsonl,
        appendScopedDailyNote: appendDailyNote,
        runPrime,
        loadFamilyConfig,
        bootstrapParentOnboarding,
        issueOnboardingInvite,
        acceptOnboardingInvite,
      },
    });

    const reply = vi.fn().mockResolvedValue(undefined);
    const ctx: TelegramContext = {
      chat: { id: 1, type: 'private' },
      message: { text: '/onboard join child kid_2 Kid 3003 teen true', message_id: 1 },
      from: { id: 456 },
      reply,
    };

    const handler = bot.handlers.messageText;
    if (!handler) throw new Error('message handler not registered');

    await handler(ctx);

    expect(issueOnboardingInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        haloHome: '/tmp/halo-onboard-child',
        inviteId: 'invite-child-kid_2-3003',
        role: 'child',
        profileId: 'young_child',
      }),
    );
    expect(acceptOnboardingInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        haloHome: '/tmp/halo-onboard-child',
        inviteId: 'invite-child-kid_2-3003',
        memberId: 'kid_2',
        telegramUserId: 3003,
        ageGroup: 'teen',
        parentalVisibility: true,
      }),
    );
    expect(reply).toHaveBeenCalledWith(
      'Onboarding join completed: kid_2 joined as child (joined).',
    );
    expect(runPrime).not.toHaveBeenCalled();
    expect(appendDailyNote).not.toHaveBeenCalled();
  });

  it('rejects /onboard join child when ageGroup is missing', async () => {
    const bot = makeFakeBot();
    const appendJsonl = vi.fn().mockResolvedValue(undefined);
    const appendDailyNote = vi.fn().mockResolvedValue('memory/2026-02-02.md');
    const runPrime = vi.fn().mockResolvedValue({ finalOutput: 'ignored' });
    const loadFamilyConfig = vi.fn().mockResolvedValue(familyConfig);
    const bootstrapParentOnboarding = vi.fn().mockResolvedValue({
      outcome: 'already_bootstrapped',
      onboarding: {},
    });
    const issueOnboardingInvite = vi.fn().mockResolvedValue({
      outcome: 'issued',
      onboarding: {},
    });
    const acceptOnboardingInvite = vi.fn().mockResolvedValue({
      outcome: 'joined',
      onboarding: { invites: [] },
    });

    createTelegramAdapter({
      token: 'token',
      bot,
      haloHome: '/tmp/halo-onboard-child-missing-age',
      now: () => new Date('2026-02-17T10:00:00.000Z'),
      deps: {
        appendJsonl,
        appendScopedDailyNote: appendDailyNote,
        runPrime,
        loadFamilyConfig,
        bootstrapParentOnboarding,
        issueOnboardingInvite,
        acceptOnboardingInvite,
      },
    });

    const reply = vi.fn().mockResolvedValue(undefined);
    const ctx: TelegramContext = {
      chat: { id: 1, type: 'private' },
      message: { text: '/onboard join child kid_3 Kid 3004', message_id: 1 },
      from: { id: 456 },
      reply,
    };

    const handler = bot.handlers.messageText;
    if (!handler) throw new Error('message handler not registered');

    await handler(ctx);

    expect(reply).toHaveBeenCalledWith(
      'Onboarding command failed: Child join requires ageGroup (child|teen|young_adult).',
    );
    expect(bootstrapParentOnboarding).not.toHaveBeenCalled();
    expect(issueOnboardingInvite).not.toHaveBeenCalled();
    expect(acceptOnboardingInvite).not.toHaveBeenCalled();
    expect(runPrime).not.toHaveBeenCalled();
    expect(appendDailyNote).not.toHaveBeenCalled();
  });

  it('handles /onboard join parent with parent role mapping', async () => {
    const bot = makeFakeBot();
    const appendJsonl = vi.fn().mockResolvedValue(undefined);
    const appendDailyNote = vi.fn().mockResolvedValue('memory/2026-02-02.md');
    const runPrime = vi.fn().mockResolvedValue({ finalOutput: 'ignored' });
    const loadFamilyConfig = vi.fn().mockResolvedValue(familyConfig);
    const bootstrapParentOnboarding = vi.fn().mockResolvedValue({
      outcome: 'already_bootstrapped',
      onboarding: {},
    });
    const issueOnboardingInvite = vi.fn().mockResolvedValue({
      outcome: 'issued',
      onboarding: {},
    });
    const acceptOnboardingInvite = vi.fn().mockResolvedValue({
      outcome: 'joined',
      onboarding: {
        invites: [
          {
            inviteId: 'invite-parent-co_parent-4004',
            role: 'parent',
          },
        ],
      },
    });

    createTelegramAdapter({
      token: 'token',
      bot,
      haloHome: '/tmp/halo-onboard-parent',
      now: () => new Date('2026-02-17T10:00:00.000Z'),
      deps: {
        appendJsonl,
        appendScopedDailyNote: appendDailyNote,
        runPrime,
        loadFamilyConfig,
        bootstrapParentOnboarding,
        issueOnboardingInvite,
        acceptOnboardingInvite,
      },
    });

    const reply = vi.fn().mockResolvedValue(undefined);
    const ctx: TelegramContext = {
      chat: { id: 1, type: 'private' },
      message: { text: '/onboard join parent co_parent CoParent 4004', message_id: 1 },
      from: { id: 456 },
      reply,
    };

    const handler = bot.handlers.messageText;
    if (!handler) throw new Error('message handler not registered');

    await handler(ctx);

    expect(issueOnboardingInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        haloHome: '/tmp/halo-onboard-parent',
        inviteId: 'invite-parent-co_parent-4004',
        role: 'parent',
        profileId: 'parent_default',
      }),
    );
    expect(acceptOnboardingInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        haloHome: '/tmp/halo-onboard-parent',
        inviteId: 'invite-parent-co_parent-4004',
        memberId: 'co_parent',
        telegramUserId: 4004,
      }),
    );
    expect(reply).toHaveBeenCalledWith(
      'Onboarding join completed: co_parent joined as parent (joined).',
    );
    expect(runPrime).not.toHaveBeenCalled();
    expect(appendDailyNote).not.toHaveBeenCalled();
  });

  it('denies onboarding commands outside parent dm context', async () => {
    const bot = makeFakeBot();
    const appendJsonl = vi.fn().mockResolvedValue(undefined);
    const appendDailyNote = vi.fn().mockResolvedValue('memory/2026-02-02.md');
    const runPrime = vi.fn().mockResolvedValue({ finalOutput: 'ignored' });
    const loadFamilyConfig = vi.fn().mockResolvedValue(familyConfig);
    const bootstrapParentOnboarding = vi.fn().mockResolvedValue({
      outcome: 'already_bootstrapped',
      onboarding: {},
    });
    const issueOnboardingInvite = vi.fn().mockResolvedValue({
      outcome: 'issued',
      onboarding: {},
    });
    const acceptOnboardingInvite = vi.fn().mockResolvedValue({
      outcome: 'joined',
      onboarding: { invites: [] },
    });

    createTelegramAdapter({
      token: 'token',
      bot,
      deps: {
        appendJsonl,
        appendScopedDailyNote: appendDailyNote,
        runPrime,
        loadFamilyConfig,
        bootstrapParentOnboarding,
        issueOnboardingInvite,
        acceptOnboardingInvite,
      },
    });

    const reply = vi.fn().mockResolvedValue(undefined);
    const ctx: TelegramContext = {
      chat: { id: 1, type: 'private' },
      message: { text: '/onboard join child kid_3 Kid 3003 child true', message_id: 1 },
      from: { id: 999 },
      reply,
    };

    const handler = bot.handlers.messageText;
    if (!handler) throw new Error('message handler not registered');

    await handler(ctx);

    expect(reply).toHaveBeenCalledWith('Onboarding commands are only available in parent DMs.');
    expect(bootstrapParentOnboarding).not.toHaveBeenCalled();
    expect(issueOnboardingInvite).not.toHaveBeenCalled();
    expect(acceptOnboardingInvite).not.toHaveBeenCalled();
    expect(runPrime).not.toHaveBeenCalled();
    expect(appendDailyNote).not.toHaveBeenCalled();
  });

  it('refreshes family config after onboarding updates so newly joined users are recognized', async () => {
    const bot = makeFakeBot();
    const appendJsonl = vi.fn().mockResolvedValue(undefined);
    const appendDailyNote = vi.fn().mockResolvedValue('memory/2026-02-02.md');
    const runPrime = vi.fn().mockResolvedValue({ finalOutput: 'welcome kid' });

    const initialFamilyConfig = {
      ...familyConfig,
      members: [
        {
          memberId: 'wags',
          displayName: 'Wags',
          role: 'parent' as const,
          telegramUserIds: [456],
        },
      ],
    };

    const updatedFamilyConfig = {
      ...familyConfig,
      members: [
        {
          memberId: 'wags',
          displayName: 'Wags',
          role: 'parent' as const,
          telegramUserIds: [456],
        },
        {
          memberId: 'kid_3',
          displayName: 'Kid',
          role: 'child' as const,
          ageGroup: 'teen' as const,
          telegramUserIds: [3003],
        },
      ],
    };

    const loadFamilyConfig = vi
      .fn()
      .mockResolvedValueOnce(initialFamilyConfig)
      .mockResolvedValue(updatedFamilyConfig);

    const bootstrapParentOnboarding = vi.fn().mockResolvedValue({
      outcome: 'already_bootstrapped',
      onboarding: {},
    });
    const issueOnboardingInvite = vi.fn().mockResolvedValue({
      outcome: 'issued',
      onboarding: {},
    });
    const acceptOnboardingInvite = vi.fn().mockResolvedValue({
      outcome: 'joined',
      onboarding: {
        invites: [
          {
            inviteId: 'invite-child-kid_3-3003',
            role: 'child',
          },
        ],
      },
    });

    createTelegramAdapter({
      token: 'token',
      bot,
      haloHome: '/tmp/halo-onboard-refresh',
      now: () => new Date('2026-02-17T10:00:00.000Z'),
      deps: {
        appendJsonl,
        appendScopedDailyNote: appendDailyNote,
        runPrime,
        loadFamilyConfig,
        bootstrapParentOnboarding,
        issueOnboardingInvite,
        acceptOnboardingInvite,
      },
    });

    const handler = bot.handlers.messageText;
    if (!handler) throw new Error('message handler not registered');

    const onboardingReply = vi.fn().mockResolvedValue(undefined);
    await handler({
      chat: { id: 1, type: 'private' },
      message: { text: '/onboard join child kid_3 Kid 3003 teen true', message_id: 1 },
      from: { id: 456 },
      reply: onboardingReply,
    });

    const childReply = vi.fn().mockResolvedValue(undefined);
    await handler({
      chat: { id: 1, type: 'private' },
      message: { text: 'hello after join', message_id: 2 },
      from: { id: 3003 },
      reply: childReply,
    });

    expect(loadFamilyConfig).toHaveBeenCalledTimes(2);
    expect(runPrime).toHaveBeenCalledWith(
      'hello after join',
      expect.objectContaining({
        userId: '3003',
        scopeId: 'telegram:dm:kid_3',
        role: 'child',
        ageGroup: 'teen',
      }),
    );
    expect(childReply).toHaveBeenCalledWith('welcome kid');
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
