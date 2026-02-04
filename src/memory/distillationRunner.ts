import type { AgentInputItem } from '@openai/agents';

import { distillMemoryFromItems } from './distiller.js';
import { distillMemoryFromItemsLLM } from './llmDistiller.js';
import { appendScopedDailyNote } from './scopedMemory.js';
import { appendScopedLongTermFacts } from './scopedLongTerm.js';

type RunDistillationOptions = {
  rootDir: string;
  scopeId: string;
  items: AgentInputItem[];
};

export type DistillationMode = 'deterministic' | 'llm';

export type RunDistillationWithModeOptions = RunDistillationOptions & {
  mode?: DistillationMode;
};

async function writeDistilled(
  opts: RunDistillationOptions,
  distilled: { durableFacts: string[]; temporalNotes: string[] },
): Promise<{ durableFacts: number; temporalNotes: number }> {
  if (distilled.durableFacts.length > 0) {
    await appendScopedLongTermFacts(
      { rootDir: opts.rootDir, scopeId: opts.scopeId },
      distilled.durableFacts,
    );
  }

  for (const note of distilled.temporalNotes) {
    await appendScopedDailyNote(
      { rootDir: opts.rootDir, scopeId: opts.scopeId },
      note,
    );
  }

  return {
    durableFacts: distilled.durableFacts.length,
    temporalNotes: distilled.temporalNotes.length,
  };
}

/**
 * Run deterministic distillation and write back to per-scope memory files.
 *
 * - durableFacts -> HALO_HOME/memory/scopes/<hash>/MEMORY.md
 * - temporalNotes -> HALO_HOME/memory/scopes/<hash>/YYYY-MM-DD.md
 */
async function runDeterministicDistillation(
  opts: RunDistillationOptions,
): Promise<{ durableFacts: number; temporalNotes: number }> {
  const distilled = distillMemoryFromItems(opts.items);
  return writeDistilled(opts, distilled);
}

/**
 * Run LLM-based distillation and write back to per-scope memory files.
 *
 * - durableFacts -> HALO_HOME/memory/scopes/<hash>/MEMORY.md
 * - temporalNotes -> HALO_HOME/memory/scopes/<hash>/YYYY-MM-DD.md
 */
async function runLLMDistillation(
  opts: RunDistillationOptions,
): Promise<{ durableFacts: number; temporalNotes: number }> {
  const distilled = await distillMemoryFromItemsLLM(opts.items);
  return writeDistilled(opts, distilled);
}

/**
 * Run distillation using the selected mode.
 */
export async function runDistillation(
  opts: RunDistillationWithModeOptions,
): Promise<{ durableFacts: number; temporalNotes: number }> {
  const mode = opts.mode ?? 'deterministic';
  if (mode === 'llm') {
    return runLLMDistillation(opts);
  }
  return runDeterministicDistillation(opts);
}
