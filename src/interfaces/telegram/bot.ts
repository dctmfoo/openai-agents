import process from 'node:process';
import { Bot } from 'grammy';
import { runPrime } from '../../prime/prime.js';
import { appendScopedDailyNote } from '../../memory/scopedMemory.js';
import { loadFamilyConfig, type FamilyConfig } from '../../runtime/familyConfig.js';
import { getHaloHome } from '../../runtime/haloHome.js';
import { appendJsonl, type EventLogRecord } from '../../utils/logging.js';
import { resolveTelegramPolicy, type TelegramPolicyDecision } from './policy.js';

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
  appendScopedDailyNote: typeof appendScopedDailyNote;
  appendJsonl: typeof appendJsonl;
  loadFamilyConfig: typeof loadFamilyConfig;
};

export type TelegramAdapterOptions = {
  token: string;
  logDir?: string;
  rootDir?: string;
  haloHome?: string;
  bot?: TelegramBotLike;
  now?: () => Date;
  deps?: Partial<TelegramAdapterDeps>;
};

export type TelegramAdapter = {
  bot: TelegramBotLike;
  start: () => Promise<void>;
};

export const UNKNOWN_DM_REPLY =
  'Hi! This bot is private to our family. Please ask a parent to invite you.';

export function createTelegramAdapter(options: TelegramAdapterOptions): TelegramAdapter {
  const {
    token,
    logDir = 'logs',
    rootDir = process.cwd(),
    haloHome = getHaloHome(process.env),
    bot: providedBot,
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
  } = {
    runPrime,
    appendScopedDailyNote,
    appendJsonl,
    loadFamilyConfig,
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

    let policy: TelegramPolicyDecision;
    try {
      const familyConfig = await getFamilyConfig();
      policy = resolveTelegramPolicy({
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
          error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
        },
      });

      await ctx.reply('Something went wrong while loading family config. Check logs.');
      return;
    }

    if (!policy.allow) {
      if (policy.reason === 'unknown_user' && ctx.chat.type === 'private') {
        await ctx.reply(UNKNOWN_DM_REPLY);
      }
      return;
    }

    const scopeId = policy.scopeId;
    if (!scopeId) {
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
      return;
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
