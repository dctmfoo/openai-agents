import { tool, type RunContext } from '@openai/agents';
import { z } from 'zod';

import {
  appendScopedDailyNote,
  getScopedDailyPath,
  getScopedLongTermPath,
} from '../memory/scopedMemory.js';
import type { PrimeContext } from '../prime/types.js';
import { TOOL_NAMES } from './toolNames.js';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

type ScopedMemoryTarget = 'long_term' | 'today' | 'yesterday';

export type ReadScopedMemoryResult = {
  target: ScopedMemoryTarget;
  path: string;
  contents: string;
};

export type ReadScopedMemoryInput = {
  rootDir: string;
  scopeId: string;
  target: ScopedMemoryTarget;
  now?: () => Date;
};

const safeRead = async (path: string): Promise<string> => {
  if (!existsSync(path)) return '';
  return await readFile(path, 'utf8');
};

export async function readScopedMemory(input: ReadScopedMemoryInput): Promise<ReadScopedMemoryResult> {
  const now = input.now ?? (() => new Date());
  const date = now();
  const yesterday = new Date(date.getTime() - 24 * 60 * 60 * 1000);

  let path: string;
  if (input.target === 'long_term') {
    path = getScopedLongTermPath({ rootDir: input.rootDir, scopeId: input.scopeId });
  } else if (input.target === 'yesterday') {
    path = getScopedDailyPath({ rootDir: input.rootDir, scopeId: input.scopeId }, yesterday);
  } else {
    path = getScopedDailyPath({ rootDir: input.rootDir, scopeId: input.scopeId }, date);
  }

  const contents = await safeRead(path);
  return { target: input.target, path, contents };
}

const requirePrimeContext = (runContext?: RunContext<PrimeContext>): PrimeContext => {
  const context = runContext?.context;
  if (!context?.rootDir || !context.scopeId) {
    throw new Error('Prime context missing rootDir/scopeId for scoped memory tools');
  }
  return context;
};

const readScopedMemorySchema = z.object({
  target: z.enum(['long_term', 'today', 'yesterday']),
});

const rememberDailySchema = z.object({
  note: z.string().min(1),
});

export const readScopedMemoryTool = tool<typeof readScopedMemorySchema, PrimeContext, ReadScopedMemoryResult>({
  name: TOOL_NAMES.readScopedMemory,
  description:
    'Read scoped memory (long-term or daily notes) for this conversation. Use to recall prior notes.',
  parameters: readScopedMemorySchema,
  execute: async ({ target }, runContext) => {
    const context = requirePrimeContext(runContext);
    return await readScopedMemory({
      rootDir: context.rootDir,
      scopeId: context.scopeId,
      target,
    });
  },
});

export const rememberDailyTool = tool<typeof rememberDailySchema, PrimeContext, string>({
  name: TOOL_NAMES.rememberDaily,
  description:
    "Append a short bullet to today's daily memory file (scoped). Use when the user wants something recorded.",
  parameters: rememberDailySchema,
  execute: async ({ note }, runContext) => {
    const context = requirePrimeContext(runContext);
    const path = await appendScopedDailyNote(
      { rootDir: context.rootDir, scopeId: context.scopeId },
      note,
    );
    return `Saved to ${path}`;
  },
});
