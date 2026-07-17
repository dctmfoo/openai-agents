import { tool, type RunContext } from '@openai/agents';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { SemanticMemory, type SemanticMemoryConfig } from '../memory/semanticMemory.js';
import type { SearchEngineOptions } from '../memory/searchEngine.js';
import type { PrimeContext } from '../prime/types.js';
import { loadHaloConfig } from '../runtime/haloConfig.js';
import { hashSessionId } from '../sessions/sessionHash.js';
import { TOOL_NAMES } from './toolNames.js';

const semanticSearchSchema = z.object({
  query: z.string().min(1),
  topK: z.number().int().positive().max(10).default(5),
});

type SemanticSearchInput = z.infer<typeof semanticSearchSchema>;

type SemanticSearchResult = Array<{
  path: string;
  snippet: string;
  score: number;
}>;

type SemanticSearchErrorCode =
  | 'semantic_memory_disabled'
  | 'semantic_memory_unavailable'
  | 'semantic_memory_error';

type SemanticSearchError = {
  code: SemanticSearchErrorCode;
  message: string;
  action?: string;
};

type SemanticSearchResponse = {
  results: SemanticSearchResult;
  error?: SemanticSearchError;
};

type ScopedRetrievalPolicyInput = {
  allowedLaneIds: string[];
  allowedScopeIds: string[];
};

type PathPolicyResolution = {
  laneId: string | null;
  scopeId: string | null;
  sawLaneHash: boolean;
  sawScopeHash: boolean;
};

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

const requirePrimeContext = (runContext?: RunContext<PrimeContext>): PrimeContext => {
  const context = runContext?.context;
  if (!context?.rootDir || !context.scopeId) {
    throw new Error('Prime context missing rootDir/scopeId for semantic search');
  }
  return context;
};

type SemanticConfigLoadResult = {
  config: SemanticMemoryConfig | null;
  error?: string;
};

const loadSemanticConfig = async (rootDir: string): Promise<SemanticConfigLoadResult> => {
  try {
    const config = await loadHaloConfig({ ...process.env, HALO_HOME: rootDir } as NodeJS.ProcessEnv);
    const semantic = config.semanticMemory;
    if (!semantic.enabled) {
      return { config: null };
    }

    return { config: semantic };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Config missing or invalid — treat semantic memory as disabled
    return { config: null, error: message };
  }
};

const buildResponse = (
  results: SemanticSearchResult,
  error?: SemanticSearchError,
): SemanticSearchResponse => ({
  results,
  error,
});

const normalizePath = (value: string): string => {
  return value.replace(/\\/g, '/');
};

const resolvePathPolicy = (
  rawPath: string,
  laneHashToId: Map<string, string>,
  scopeHashToId: Map<string, string>,
): PathPolicyResolution => {
  const path = normalizePath(rawPath);
  const segments = path.split('/').filter((segment) => segment.length > 0);

  let laneId: string | null = null;
  let scopeId: string | null = null;
  let sawLaneHash = false;
  let sawScopeHash = false;

  const laneIndex = segments.lastIndexOf('lanes');
  if (laneIndex >= 0 && laneIndex + 1 < segments.length) {
    const laneHash = segments[laneIndex + 1];
    sawLaneHash = true;
    laneId = laneHashToId.get(laneHash) ?? null;
  }

  const scopeIndex = segments.lastIndexOf('scopes');
  if (scopeIndex >= 0 && scopeIndex + 1 < segments.length) {
    const scopeHash = segments[scopeIndex + 1];
    sawScopeHash = true;
    scopeId = scopeHashToId.get(scopeHash) ?? null;
  }

  const transcriptMatch = path.match(/\/transcripts\/([a-f0-9]{64})\.jsonl$/i);
  if (transcriptMatch?.[1]) {
    sawScopeHash = true;
    const transcriptScopeId = scopeHashToId.get(transcriptMatch[1]);
    if (transcriptScopeId) {
      scopeId = transcriptScopeId;
    }
  }

  return {
    laneId,
    scopeId,
    sawLaneHash,
    sawScopeHash,
  };
};

export function buildScopedRetrievalCandidatePrefilter(
  input: ScopedRetrievalPolicyInput,
): NonNullable<SearchEngineOptions['candidatePrefilter']> {
  const allowedLaneIds = stableUnique(input.allowedLaneIds);
  const allowedScopeIds = stableUnique(input.allowedScopeIds);

  const allowedLaneSet = new Set(allowedLaneIds);
  const allowedScopeSet = new Set(allowedScopeIds);

  const laneHashToId = new Map<string, string>();
  for (const laneId of allowedLaneIds) {
    laneHashToId.set(hashSessionId(laneId), laneId);
  }

  const scopeHashToId = new Map<string, string>();
  for (const scopeId of allowedScopeIds) {
    scopeHashToId.set(hashSessionId(scopeId), scopeId);
  }

  return ({ candidate }) => {
    const policy = resolvePathPolicy(candidate.path, laneHashToId, scopeHashToId);

    if (policy.sawScopeHash && !policy.scopeId) {
      return false;
    }

    if (policy.sawLaneHash && !policy.laneId) {
      return false;
    }

    if (policy.scopeId && allowedScopeSet.size > 0 && !allowedScopeSet.has(policy.scopeId)) {
      return false;
    }

    if (policy.laneId && allowedLaneSet.size > 0 && !allowedLaneSet.has(policy.laneId)) {
      return false;
    }

    if (!policy.scopeId && !policy.laneId) {
      if (allowedScopeSet.size > 0 || allowedLaneSet.size > 0) {
        return false;
      }
    }

    return true;
  };
}

export async function semanticSearch(
  input: SemanticSearchInput,
  context: PrimeContext,
): Promise<SemanticSearchResponse> {
  const { config: semanticConfig, error } = await loadSemanticConfig(context.rootDir);
  if (!semanticConfig) {
    return buildResponse([], {
      code: error ? 'semantic_memory_unavailable' : 'semantic_memory_disabled',
      message: error ? `Semantic memory unavailable: ${error}` : 'Semantic memory disabled in config.',
      action: 'Enable semanticMemory in config.json or run `pnpm doctor`.',
    });
  }

  if (!semanticConfig.vecExtensionPath) {
    return buildResponse([], {
      code: 'semantic_memory_unavailable',
      message: 'sqlite-vec extension path is missing.',
      action: 'Set SQLITE_VEC_EXT or semanticMemory.vecExtensionPath in config.json.',
    });
  }

  if (!existsSync(semanticConfig.vecExtensionPath)) {
    return buildResponse([], {
      code: 'semantic_memory_unavailable',
      message: `sqlite-vec extension not found at ${semanticConfig.vecExtensionPath}.`,
      action: 'Set SQLITE_VEC_EXT to a valid path or disable semanticMemory in config.json.',
    });
  }

  const allowedScopeIds = stableUnique(
    context.allowedMemoryReadScopes && context.allowedMemoryReadScopes.length > 0
      ? context.allowedMemoryReadScopes
      : [context.scopeId],
  );
  const allowedLaneIds = stableUnique(context.allowedMemoryReadLanes ?? []);

  const candidatePrefilter = buildScopedRetrievalCandidatePrefilter({
    allowedLaneIds,
    allowedScopeIds,
  });

  try {
    const memory = new SemanticMemory({
      rootDir: context.rootDir,
      scopeId: context.scopeId,
      searchEngineOptions: {
        candidatePrefilter,
      },
      semanticConfig,
    });

    const results = await memory.search(input.query, input.topK, semanticConfig);
    return buildResponse(
      results.map((item) => ({
        path: item.path,
        snippet: item.snippet,
        score: item.score,
      })),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const lower = message.toLowerCase();
    if (lower.includes('sqlite-vec') || lower.includes('sqlite_vec_ext')) {
      return buildResponse([], {
        code: 'semantic_memory_unavailable',
        message: 'sqlite-vec extension could not be loaded.',
        action: 'Set SQLITE_VEC_EXT or disable semanticMemory in config.json.',
      });
    }
    return buildResponse([], {
      code: 'semantic_memory_error',
      message,
      action: 'Check logs or run `pnpm doctor`.',
    });
  }
}

export const semanticSearchTool = tool<typeof semanticSearchSchema, PrimeContext, SemanticSearchResponse>({
  name: TOOL_NAMES.semanticSearch,
  description: 'Search scoped memory using semantic + keyword search.',
  parameters: semanticSearchSchema,
  execute: async ({ query, topK }: SemanticSearchInput, runContext) => {
    const context = requirePrimeContext(runContext);
    return await semanticSearch({ query, topK }, context);
  },
});
