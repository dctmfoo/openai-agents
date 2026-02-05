import {
  embedWithFallback,
  createOpenAIEmbeddingProvider,
  createGeminiEmbeddingProvider,
  type EmbeddingProvider,
} from './embeddings.js';
import { SearchEngine, type SearchEngineOptions, type SearchResult } from './searchEngine.js';
import { SyncManager, type SyncManagerOptions, type SyncVectorStore } from './syncManager.js';
import { VectorStore, type VectorStoreConfig } from './vectorStore.js';

export type SemanticMemoryConfig = {
  enabled: boolean;
  embeddingProvider: 'openai' | 'gemini';
  embeddingModel: string;
  embeddingDimensions: number;
  vecExtensionPath?: string;
  search: {
    fusionMethod: 'rrf';
    vectorWeight: number;
    textWeight: number;
    minScore: number;
  };
  recencyHalfLifeDays?: number;
  accessWeight?: number;
};

type VectorStoreFactory = (config: VectorStoreConfig) => Promise<SyncVectorStore>;
type SearchEngineFactory = (store: SyncVectorStore, options: Partial<SearchEngineOptions>) => {
  search: (request: { query: string; embedding: number[]; topK: number }) => Promise<SearchResult[]>;
};
type SyncManagerFactory = (options: SyncManagerOptions) => { sync: () => Promise<void> };

export class SemanticMemory {
  private readonly rootDir: string;
  private readonly scopeId: string;
  private readonly embedder: (texts: string[]) => Promise<number[][]>;
  private readonly vectorStoreFactory: VectorStoreFactory;
  private readonly searchEngineFactory: SearchEngineFactory;
  private readonly syncManagerFactory: SyncManagerFactory;

  private store: SyncVectorStore | null = null;
  private searchEngine: { search: (request: { query: string; embedding: number[]; topK: number }) => Promise<SearchResult[]> } | null = null;
  private syncManager: { sync: () => Promise<void> } | null = null;
  private readonly searchOptions: Partial<SearchEngineOptions>;

  constructor(options: {
    rootDir: string;
    scopeId: string;
    semanticConfig?: SemanticMemoryConfig;
    embedder?: (texts: string[]) => Promise<number[][]>;
    vectorStoreFactory?: VectorStoreFactory;
    searchEngineFactory?: SearchEngineFactory;
    syncManagerFactory?: SyncManagerFactory;
  }) {
    this.rootDir = options.rootDir;
    this.scopeId = options.scopeId;

    const semantic = options.semanticConfig;
    if (options.embedder) {
      this.embedder = options.embedder;
    } else {
      const providers: EmbeddingProvider[] = [];
      const dimensions = semantic?.embeddingDimensions ?? 1536;
      const primary = semantic?.embeddingProvider ?? 'openai';
      if (primary === 'openai') {
        providers.push(
          createOpenAIEmbeddingProvider({
            model: semantic?.embeddingModel ?? 'text-embedding-3-small',
            dimensions,
          }),
        );
        if (process.env.GEMINI_API_KEY) {
          providers.push(
            createGeminiEmbeddingProvider({
              model: 'text-embedding-004',
              dimensions,
            }),
          );
        }
      } else if (primary === 'gemini') {
        providers.push(
          createGeminiEmbeddingProvider({
            model: semantic?.embeddingModel ?? 'text-embedding-004',
            dimensions,
          }),
        );
      }
      this.embedder = (texts: string[]) =>
        embedWithFallback(texts, providers, {
          expectedDimensions: dimensions,
        }).then((res) => res.vectors);
    }

    this.vectorStoreFactory =
      options.vectorStoreFactory ??
      (async (config) => {
        const store = await VectorStore.open(config);
        return store as unknown as SyncVectorStore;
      });
    this.searchEngineFactory =
      options.searchEngineFactory ??
      ((store, searchOptions) => new SearchEngine(store as any, searchOptions));
    this.syncManagerFactory =
      options.syncManagerFactory ??
      ((syncOptions) => new SyncManager(syncOptions));

    this.searchOptions = {
      vectorWeight: semantic?.search.vectorWeight ?? 0.7,
      textWeight: semantic?.search.textWeight ?? 0.3,
      minScore: semantic?.search.minScore ?? 0.005,
      rrfK: 60,
      recencyHalfLifeDays: semantic?.recencyHalfLifeDays ?? 30,
      accessWeight: semantic?.accessWeight ?? 0.1,
    };
  }

  private async ensureInitialized(semanticConfig?: SemanticMemoryConfig) {
    if (this.store && this.searchEngine && this.syncManager) return;

    if (!semanticConfig) {
      throw new Error('Semantic memory config is required to initialize');
    }

    this.store = await this.vectorStoreFactory({
      rootDir: this.rootDir,
      scopeId: this.scopeId,
      embedding: {
        provider: semanticConfig.embeddingProvider,
        model: semanticConfig.embeddingModel,
        dimensions: semanticConfig.embeddingDimensions,
      },
      vecExtensionPath: semanticConfig.vecExtensionPath,
    });
    this.searchEngine = this.searchEngineFactory(this.store, this.searchOptions);
    this.syncManager = this.syncManagerFactory({
      rootDir: this.rootDir,
      scopeId: this.scopeId,
      vectorStore: this.store,
      embedder: this.embedder,
    });
  }

  async sync(semanticConfig: SemanticMemoryConfig): Promise<void> {
    await this.ensureInitialized(semanticConfig);
    if (!this.syncManager) return;
    await this.syncManager.sync();
  }

  async search(query: string, topK: number, semanticConfig?: SemanticMemoryConfig): Promise<SearchResult[]> {
    await this.ensureInitialized(semanticConfig);
    if (!this.searchEngine) return [];
    await this.syncManager?.sync();
    const vectors = await this.embedder([query]);
    return this.searchEngine.search({ query, embedding: vectors[0], topK });
  }
}
