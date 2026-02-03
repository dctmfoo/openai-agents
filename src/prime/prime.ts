import { Agent, run, tool } from '@openai/agents';
import { z } from 'zod';
import process from 'node:process';
import { appendDailyNote, loadMarkdownContextFiles } from '../memory/memoryFiles.js';
import { defaultSessionStore } from '../sessions/sessionStore.js';

export type PrimeRunOptions = {
  /** Stable identifier for the current speaker (Telegram user id, etc.) */
  userId?: string;
  /** Stable identifier for the conversation scope (e.g. Telegram chat id). */
  scopeId?: string;
  channel?: 'telegram' | 'cli';
};

const getTime = tool({
  name: 'get_time',
  description: 'Get the current time in ISO format. Use when you need an exact timestamp.',
  parameters: z.object({}),
  execute: async () => {
    return new Date().toISOString();
  },
});

const rememberDaily = tool({
  name: 'remember_daily',
  description:
    "Append a short bullet to today's daily memory file (memory/YYYY-MM-DD.md). Use when the user wants something recorded.",
  parameters: z.object({ note: z.string().min(1) }),
  execute: async ({ note }) => {
    const rootDir = process.cwd();
    const path = await appendDailyNote({ rootDir }, note);
    return `Saved to ${path}`;
  },
});

async function makePrimeAgent() {
  const rootDir = process.cwd();
  const ctx = await loadMarkdownContextFiles({ rootDir });

  const contextBlock = [
    '---',
    'Context files (read-only excerpts):',
    ctx.soul ? `\n[SOUL.md]\n${ctx.soul}` : '',
    ctx.user ? `\n[USER.md]\n${ctx.user}` : '',
    ctx.longTerm ? `\n[MEMORY.md]\n${ctx.longTerm}` : '',
    ctx.yesterday ? `\n[memory/yesterday]\n${ctx.yesterday}` : '',
    ctx.today ? `\n[memory/today]\n${ctx.today}` : '',
    '---',
  ]
    .filter(Boolean)
    .join('\n');

  return new Agent({
    name: 'Prime',
    instructions: [
      'You are Prime, a personal AI companion.',
      'Be helpful, direct, and concise.',
      'Do not claim you performed actions you did not do.',
      'If you need the current time, call get_time.',
      'If the user asks you to remember something or take a note, call remember_daily with a short bullet.',
      '',
      contextBlock,
    ].join('\n'),
    tools: [getTime, rememberDaily],
  });
}

export async function runPrime(input: string, opts: PrimeRunOptions = {}) {
  const agent = await makePrimeAgent();

  const scopeId = opts.scopeId ?? `default:${opts.channel ?? 'unknown'}:${opts.userId ?? 'unknown'}`;
  const session = defaultSessionStore.getOrCreate(scopeId);

  const result = await run(agent, input, {
    session,
  });

  return {
    finalOutput: result.finalOutput,
    raw: result,
  };
}
