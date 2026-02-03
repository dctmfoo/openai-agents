import process from 'node:process';
import { Bot } from 'grammy';
import { runPrime } from '../../prime/prime.js';
import { appendDailyNote } from '../../memory/memoryFiles.js';
import { appendJsonl, type EventLogRecord } from '../../utils/logging.js';

export type TelegramContext = {
  chat: { id: number; type: string };
  message: { text?: string; message_id: number };
  from?: { id?: number | string };
  reply: (text: string) => Promise<unknown>;
};

export type TelegramBotLike = {
  on: (event: 'message:text', handler: (ctx: TelegramContext) => Promise<void> | void) => void;
  catch: (handler: (err: unknown) => Promise<void> | void) => void;
  start: () => Promise<void>;
};

type TelegramAdapterDeps = {
  runPrime: typeof runPrime;
  appendDailyNote: typeof appendDailyNote;
  appendJsonl: typeof appendJsonl;
};

export type TelegramAdapterOptions = {
  token: string;
  logDir?: string;
  rootDir?: string;
  bot?: TelegramBotLike;
  now?: () => Date;
  deps?: Partial<TelegramAdapterDeps>;
};

export type TelegramAdapter = {
  bot: TelegramBotLike;
  start: () => Promise<void>;
};

export function createTelegramAdapter(options: TelegramAdapterOptions): TelegramAdapter {
  const {
    token,
    logDir = 'logs',
    rootDir = process.cwd(),
    bot: providedBot,
    now = () => new Date(),
    deps = {},
  } = options;

  if (!token) {
    throw new Error('Missing TELEGRAM_BOT_TOKEN in environment');
  }

  const { runPrime: runPrimeImpl, appendDailyNote: appendDailyNoteImpl, appendJsonl: appendJsonlImpl } = {
    runPrime,
    appendDailyNote,
    appendJsonl,
    ...deps,
  };

  const logPath = `${logDir}/events.jsonl`;
  const bot = providedBot ?? (new Bot(token) as unknown as TelegramBotLike);

  const writeLog = async (record: EventLogRecord) => {
    await appendJsonlImpl(logPath, record);
  };

  bot.on('message:text', async (ctx) => {
    const chatType = ctx.chat.type;

    // Private only (as per Wags requirement).
    if (chatType !== 'private') return;

    const text = ctx.message.text?.trim();
    if (!text) return;

    const userId = String(ctx.from?.id ?? 'unknown');
    const scopeId = `telegram:${ctx.chat.id}`;

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

    await writeLog({
      ts: now().toISOString(),
      type: 'prime.run.start',
      data: { channel: 'telegram', userId, scopeId },
    });

    try {
      const result = await runPrimeImpl(text, { channel: 'telegram', userId, scopeId });
      const finalOutput = String(result.finalOutput ?? '').trim() || '(no output)';

      // Persist a lightweight transcript to the daily memory file.
      await appendDailyNoteImpl({ rootDir }, `[user] ${text}`);
      await appendDailyNoteImpl({ rootDir }, `[prime] ${finalOutput}`);

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

  bot.catch(async (err) => {
    const e = err as any;
    await writeLog({
      ts: now().toISOString(),
      type: 'prime.run.error',
      data: {
        channel: 'telegram',
        error: {
          message: e?.error?.message ?? String(e?.error ?? err),
        },
      },
    });
  });

  return {
    bot,
    start: () => bot.start(),
  };
}
