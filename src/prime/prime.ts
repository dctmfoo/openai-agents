import { Agent, run } from '@openai/agents';
import process from 'node:process';
import { loadScopedContextFiles } from '../memory/scopedMemory.js';
import { defaultSessionStore, type SessionStore } from '../sessions/sessionStore.js';
import { buildPrimeTools } from '../tools/registry.js';
import { TOOL_NAMES } from '../tools/toolNames.js';
import type { PrimeContext } from './types.js';

export type PrimeRunOptions = {
  /** Stable identifier for the current speaker (Telegram user id, etc.) */
  userId?: string;
  /** Stable identifier for the conversation scope (e.g. Telegram chat id). */
  scopeId?: string;
  /** Root directory for durable runtime state (HALO_HOME). Defaults to process.cwd() for CLI/dev. */
  rootDir?: string;
  /** Optional session store override (used by gateway to apply config.json). */
  sessionStore?: SessionStore;
  channel?: 'telegram' | 'cli';
  role?: 'parent' | 'child';
  scopeType?: 'dm' | 'parents_group';
};

const buildToolInstructions = (toolNames: string[]) => {
  const instructions: string[] = [];

  if (toolNames.includes(TOOL_NAMES.readScopedMemory)) {
    instructions.push(
      'If you need to recall prior notes, call read_scoped_memory with target long_term, today, or yesterday.',
    );
  }

  if (toolNames.includes(TOOL_NAMES.rememberDaily)) {
    instructions.push(
      "If the user asks you to remember something or take a note, call remember_daily with a short bullet.",
    );
  }

  if (toolNames.includes(TOOL_NAMES.webSearch)) {
    instructions.push(
      'If you need to look something up on the web, call web_search_call.',
    );
  }

  return instructions;
};

async function makePrimeAgent(context: PrimeContext) {
  const ctx = await loadScopedContextFiles({
    rootDir: context.rootDir,
    scopeId: context.scopeId,
  });

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

  const tools = buildPrimeTools(context);
  const toolInstructions = buildToolInstructions(tools.map((tool) => tool.name));

  return new Agent({
    name: 'Prime',
    instructions: [
      'You are Prime, a personal AI companion.',
      'Be helpful, direct, and concise.',
      'Do not claim you performed actions you did not do.',
      ...toolInstructions,
      '',
      contextBlock,
    ].join('\n'),
    tools,
  });
}

export async function runPrime(input: string, opts: PrimeRunOptions = {}) {
  const scopeId = opts.scopeId ?? `default:${opts.channel ?? 'unknown'}:${opts.userId ?? 'unknown'}`;
  const rootDir = opts.rootDir ?? process.cwd();
  const role =
    opts.role ?? (opts.channel === 'cli' ? 'parent' : undefined);
  const scopeType =
    opts.scopeType ?? (opts.channel === 'cli' ? 'dm' : undefined);

  const context: PrimeContext = {
    rootDir,
    scopeId,
    channel: opts.channel,
    role,
    scopeType,
  };

  const agent = await makePrimeAgent(context);

  const store = opts.sessionStore ?? defaultSessionStore;
  const session = store.getOrCreate(scopeId);

  const result = await run(agent, input, {
    session,
    context,
  });

  return {
    finalOutput: result.finalOutput,
    raw: result,
  };
}
