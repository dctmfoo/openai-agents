import { tool, type RunContext } from '@openai/agents';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { loadHaloConfig } from '../runtime/haloConfig.js';
import type { PrimeContext } from '../prime/types.js';
import { SemanticMemory, type SemanticMemoryConfig } from '../memory/semanticMemory.js';
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
    const semantic = (config as any).semanticMemory as SemanticMemoryConfig | undefined;
    if (!semantic?.enabled) return { config: null };
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

  try {
    const memory = new SemanticMemory({
      rootDir: context.rootDir,
      scopeId: context.scopeId,
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
