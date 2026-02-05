import { describe, expect, it, vi } from 'vitest';

import { SemanticMemory } from './semanticMemory.js';

describe('semanticMemory', () => {
  it('runs sync then search', async () => {
    const sync = vi.fn().mockResolvedValue(undefined);
    const search = vi.fn().mockResolvedValue([{ chunkIdx: 1 }]);
    const embed = vi.fn().mockResolvedValue([[0, 1]]);

    const mockStore = {
      listFiles: () => [],
      getFile: () => null,
      upsertFile: () => undefined,
      deleteFile: () => undefined,
      getEmbeddingCache: () => null,
      upsertEmbeddingCache: () => undefined,
      getActiveChunksForPath: () => [],
      insertChunks: () => [],
      supersedeChunks: () => undefined,
    } as unknown as import('./syncManager.js').SyncVectorStore;

    const memory = new SemanticMemory({
      rootDir: '/root',
      scopeId: 'telegram:dm:wags',
      semanticConfig: {
        enabled: true,
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-small',
        embeddingDimensions: 1536,
        search: { fusionMethod: 'rrf', vectorWeight: 0.7, textWeight: 0.3, minScore: 0.005 },
      },
      vectorStoreFactory: async () => mockStore,
      embedder: embed,
      searchEngineFactory: () => ({ search }),
      syncManagerFactory: () => ({ sync }),
    });

    const result = await memory.search('hello', 3, {
      enabled: true,
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-small',
      embeddingDimensions: 1536,
      search: { fusionMethod: 'rrf', vectorWeight: 0.7, textWeight: 0.3, minScore: 0.005 },
    });
    expect(sync).toHaveBeenCalled();
    expect(embed).toHaveBeenCalledWith(['hello']);
    expect(search).toHaveBeenCalled();
    expect(result.length).toBe(1);
  });
});
