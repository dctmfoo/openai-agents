import 'dotenv/config';

import process from 'node:process';
import { Bot } from 'grammy';
import { runPrime } from '../../prime/prime.js';
import { appendDailyNote } from '../../memory/memoryFiles.js';
import { appendJsonl } from '../../utils/logging.js';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error('Missing TELEGRAM_BOT_TOKEN in environment');
}

const logDir = process.env.LOG_DIR || 'logs';
const logPath = `${logDir}/events.jsonl`;

const bot = new Bot(token);

bot.on('message:text', async (ctx) => {
  const chatType = ctx.chat.type;

  // Private only (as per Wags requirement).
  if (chatType !== 'private') return;

  const text = ctx.message.text?.trim();
  if (!text) return;

  const userId = String(ctx.from?.id ?? 'unknown');
  const scopeId = `telegram:${ctx.chat.id}`;

  await appendJsonl(logPath, {
    ts: new Date().toISOString(),
    type: 'telegram.update',
    data: {
      chatId: ctx.chat.id,
      userId,
      messageId: ctx.message.message_id,
      text,
    },
  });

  await appendJsonl(logPath, {
    ts: new Date().toISOString(),
    type: 'prime.run.start',
    data: { channel: 'telegram', userId, scopeId },
  });

  try {
    const result = await runPrime(text, { channel: 'telegram', userId, scopeId });

    // Persist a lightweight transcript to the daily memory file.
    await appendDailyNote({ rootDir: process.cwd() }, `[user] ${text}`);
    await appendDailyNote(
      { rootDir: process.cwd() },
      `[prime] ${String(result.finalOutput ?? '').trim() || '(no output)'}`,
    );

    await appendJsonl(logPath, {
      ts: new Date().toISOString(),
      type: 'prime.run.success',
      data: {
        channel: 'telegram',
        userId,
        scopeId,
        finalOutput: result.finalOutput,
      },
    });

    await ctx.reply(String(result.finalOutput ?? '').trim() || '(no output)');
  } catch (err) {
    await appendJsonl(logPath, {
      ts: new Date().toISOString(),
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
  await appendJsonl(logPath, {
    ts: new Date().toISOString(),
    type: 'prime.run.error',
    data: {
      channel: 'telegram',
      error: {
        message: e?.error?.message ?? String(e?.error ?? err),
      },
    },
  });
});

console.log('halo (telegram) starting…');
await bot.start();
