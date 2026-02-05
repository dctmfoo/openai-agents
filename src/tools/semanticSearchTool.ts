import { tool, type RunContext } from '@openai/agents';
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

export type SemanticSearchResult = Array<{
  path: string;
  snippet: string;
  score: number;
}>;

const requirePrimeContext = (runContext?: RunContext<PrimeContext>): PrimeContext => {
  const context = runContext?.context;
  if (!context?.rootDir || !context.scopeId) {
    throw new Error('Prime context missing rootDir/scopeId for semantic search');
  }
  return context;
};

const loadSemanticConfig = async (rootDir: string): Promise<SemanticMemoryConfig | null> => {
  try {
    const config = await loadHaloConfig({ ...process.env, HALO_HOME: rootDir } as NodeJS.ProcessEnv);
    const semantic = (config as any).semanticMemory as SemanticMemoryConfig | undefined;
    if (!semantic?.enabled) return null;
    return semantic;
  } catch {
    // Config missing or invalid — treat semantic memory as disabled
    return null;
  }
};

export async function semanticSearch(
  input: SemanticSearchInput,
  context: PrimeContext,
): Promise<SemanticSearchResult> {
  const semanticConfig = await loadSemanticConfig(context.rootDir);
  if (!semanticConfig) return [];

  const memory = new SemanticMemory({
    rootDir: context.rootDir,
    scopeId: context.scopeId,
    semanticConfig,
  });

  const results = await memory.search(input.query, input.topK, semanticConfig);
  return results.map((item) => ({
    path: item.path,
    snippet: item.snippet,
    score: item.score,
  }));
}

export const semanticSearchTool = tool<typeof semanticSearchSchema, PrimeContext, SemanticSearchResult>({
  name: TOOL_NAMES.semanticSearch,
  description: 'Search scoped memory using semantic + keyword search.',
  parameters: semanticSearchSchema,
  execute: async ({ query, topK }: SemanticSearchInput, runContext) => {
    const context = requirePrimeContext(runContext);
    return await semanticSearch({ query, topK }, context);
  },
});
