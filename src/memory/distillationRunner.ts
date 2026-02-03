import type { AgentInputItem } from '@openai/agents';

import { distillMemoryFromItems } from './distiller.js';
import { appendScopedDailyNote } from './scopedMemory.js';
import { appendScopedLongTermFacts } from './scopedLongTerm.js';

export type RunDistillationOptions = {
  rootDir: string;
  scopeId: string;
  items: AgentInputItem[];
};

/**
 * Run deterministic distillation and write back to per-scope memory files.
 *
 * - durableFacts -> HALO_HOME/memory/scopes/<hash>/MEMORY.md
 * - temporalNotes -> HALO_HOME/memory/scopes/<hash>/YYYY-MM-DD.md
 */
export async function runDeterministicDistillation(
  opts: RunDistillationOptions,
): Promise<{ durableFacts: number; temporalNotes: number }> {
  const distilled = distillMemoryFromItems(opts.items);

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
