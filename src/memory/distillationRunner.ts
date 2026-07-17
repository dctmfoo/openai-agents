import type { AgentInputItem } from '@openai/agents';

import { resolveMemberMemoryLanes } from './laneTopology.js';
import { appendLaneDailyNotesUnique, appendLaneLongTermFacts } from './laneMemory.js';
import { distillMemoryFromItems } from './distiller.js';
import { distillMemoryFromItemsLLM } from './llmDistiller.js';
import { loadFamilyConfig } from '../runtime/familyConfig.js';

type RunDistillationOptions = {
  rootDir: string;
  scopeId: string;
  items: AgentInputItem[];
  writeLanes?: string[];
};

export type DistillationMode = 'deterministic' | 'llm';

type RunDistillationWithModeOptions = RunDistillationOptions & {
  mode?: DistillationMode;
};

type DistilledOutput = {
  durableFacts: string[];
  temporalNotes: string[];
};

const DM_SCOPE_PREFIX = 'telegram:dm:';
const PARENTS_GROUP_SCOPE_PREFIX = 'telegram:parents_group:';
const FAMILY_GROUP_SCOPE_PREFIX = 'telegram:family_group:';

const stableUnique = (values: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }

    if (seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    out.push(trimmed);
  }

  return out;
};

const scopeMemberId = (scopeId: string): string | null => {
  if (!scopeId.startsWith(DM_SCOPE_PREFIX)) {
    return null;
  }

  const memberId = scopeId.slice(DM_SCOPE_PREFIX.length).trim();
  if (!memberId) {
    return null;
  }

  return memberId;
};

const resolveScopedDefaults = (scopeId: string): string[] => {
  if (scopeId.startsWith(PARENTS_GROUP_SCOPE_PREFIX)) {
    return ['parents_shared'];
  }

  if (scopeId.startsWith(FAMILY_GROUP_SCOPE_PREFIX)) {
    return ['family_shared'];
  }

  return ['system_audit'];
};

async function resolveWriteLanes(opts: RunDistillationOptions): Promise<string[]> {
  if (opts.writeLanes && opts.writeLanes.length > 0) {
    return stableUnique(opts.writeLanes);
  }

  const memberId = scopeMemberId(opts.scopeId);
  if (!memberId) {
    return resolveScopedDefaults(opts.scopeId);
  }

  try {
    const family = await loadFamilyConfig({ haloHome: opts.rootDir });
    const member = family.members.find((candidate) => {
      return candidate.memberId === memberId;
    });

    if (!member) {
      return ['system_audit'];
    }

    const lanes = resolveMemberMemoryLanes(family, member);
    if (lanes.writeLanes.length === 0) {
      return ['system_audit'];
    }

    return stableUnique(lanes.writeLanes);
  } catch {
    return ['system_audit'];
  }
}

async function writeToLaneMemory(
  opts: RunDistillationOptions,
  distilled: DistilledOutput,
): Promise<void> {
  const lanes = await resolveWriteLanes(opts);

  for (const laneId of lanes) {
    if (distilled.durableFacts.length > 0) {
      await appendLaneLongTermFacts(
        { rootDir: opts.rootDir, laneId },
        distilled.durableFacts,
      );
    }

    if (distilled.temporalNotes.length > 0) {
      await appendLaneDailyNotesUnique(
        { rootDir: opts.rootDir, laneId },
        distilled.temporalNotes,
      );
    }
  }
}

async function writeDistilled(
  opts: RunDistillationOptions,
  distilled: DistilledOutput,
): Promise<{ durableFacts: number; temporalNotes: number }> {
  await writeToLaneMemory(opts, distilled);

  return {
    durableFacts: distilled.durableFacts.length,
    temporalNotes: distilled.temporalNotes.length,
  };
}

/**
 * Run deterministic distillation and write back to memory files.
 */
async function runDeterministicDistillation(
  opts: RunDistillationOptions,
): Promise<{ durableFacts: number; temporalNotes: number }> {
  const distilled = distillMemoryFromItems(opts.items);
  return await writeDistilled(opts, distilled);
}

/**
 * Run LLM-based distillation and write back to memory files.
 */
async function runLLMDistillation(
  opts: RunDistillationOptions,
): Promise<{ durableFacts: number; temporalNotes: number }> {
  const distilled = await distillMemoryFromItemsLLM(opts.items);
  return await writeDistilled(opts, distilled);
}

/**
 * Run distillation using the selected mode.
 */
export async function runDistillation(
  opts: RunDistillationWithModeOptions,
): Promise<{ durableFacts: number; temporalNotes: number }> {
  const mode = opts.mode ?? 'deterministic';
  if (mode === 'llm') {
    return await runLLMDistillation(opts);
  }

  return await runDeterministicDistillation(opts);
}
