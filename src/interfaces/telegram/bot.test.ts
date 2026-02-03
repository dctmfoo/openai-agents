import { describe, expect, it, vi } from 'vitest';

import {
  createTelegramAdapter,
  UNKNOWN_DM_REPLY,
  type TelegramBotLike,
  type TelegramContext,
} from './bot.js';

type HandlerBag = {
  messageText?: (ctx: TelegramContext) => Promise<void> | void;
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
    },
    catch: (handler) => {
      handlers.error = handler;
    },
    start: vi.fn().mockResolvedValue(undefined),
  };
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
    const now = () => new Date('2026-02-02T00:00:00.000Z');

    createTelegramAdapter({
      token: 'token',
      logDir: 'logs',
      rootDir: '/root',
      bot,
      now,
      deps: { appendJsonl, appendDailyNote, runPrime, loadFamilyConfig },
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
    });
    expect(appendDailyNote).toHaveBeenCalledWith({ rootDir: '/root' }, '[user] hello');
    expect(appendDailyNote).toHaveBeenCalledWith({ rootDir: '/root' }, '[prime] hi there');
    expect(reply).toHaveBeenCalledWith('hi there');

    expect(appendJsonl).toHaveBeenCalledTimes(3);
    const [logPath, firstRecord] = appendJsonl.mock.calls[0];
    expect(logPath).toBe('logs/events.jsonl');
    expect(firstRecord.type).toBe('telegram.update');
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
      deps: { appendJsonl, appendDailyNote, runPrime, loadFamilyConfig },
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
      deps: { appendJsonl, appendDailyNote, runPrime, loadFamilyConfig },
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
