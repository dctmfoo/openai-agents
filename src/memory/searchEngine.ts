type VectorResult = {
  chunkIdx: number;
  distance: number;
  content: string;
  path: string;
  updatedAt: number;
  accessCount: number;
  lastAccessedAt: number | null;
};

type TextResult = {
  chunkIdx: number;
  score: number;
  content: string;
  path: string;
  updatedAt: number;
  accessCount: number;
  lastAccessedAt: number | null;
};

type SearchStore = {
  vectorSearch: (embedding: number[], limit: number) => VectorResult[];
  textSearch: (query: string, limit: number) => TextResult[];
  markAccess: (chunkIdxs: number[]) => void;
};

export type SearchEngineOptions = {
  vectorWeight: number;
  textWeight: number;
  rrfK: number;
  minScore: number;
  recencyHalfLifeDays: number;
  accessWeight: number;
};

export type SearchRequest = {
  query: string;
  embedding: number[];
  topK: number;
};

export type SearchResult = {
  chunkIdx: number;
  content: string;
  path: string;
  score: number;
  snippet: string;
  baseScore: number;
  recencyBoost: number;
  accessBoost: number;
};

const DEFAULT_OPTIONS: SearchEngineOptions = {
  vectorWeight: 0.7,
  textWeight: 0.3,
  rrfK: 60,
  minScore: 0.005,
  recencyHalfLifeDays: 30,
  accessWeight: 0.1,
};

const rrfScore = (rank: number, k: number) => 1 / (k + rank);

const computeRecencyBoost = (updatedAt: number, halfLifeDays: number) => {
  const ageMs = Date.now() - updatedAt;
  const ageDays = Math.max(0, ageMs / (1000 * 60 * 60 * 24));
  const decay = Math.pow(2, -ageDays / Math.max(1, halfLifeDays));
  return 1 + decay;
};

const computeAccessBoost = (accessCount: number, weight: number) => {
  return 1 + Math.log1p(Math.max(0, accessCount)) * weight;
};

const makeSnippet = (content: string, maxLength = 240) => {
  if (content.length <= maxLength) return content;
  return `${content.slice(0, maxLength).trim()}…`;
};

export class SearchEngine {
  private readonly store: SearchStore;
  private readonly options: SearchEngineOptions;

  constructor(store: SearchStore, options: Partial<SearchEngineOptions> = {}) {
    this.store = store;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async search(request: SearchRequest): Promise<SearchResult[]> {
    const vectorResults = this.store.vectorSearch(request.embedding, request.topK);
    const textResults = this.store.textSearch(request.query, request.topK);

    const combined = new Map<number, {
      content: string;
      path: string;
      vectorRank?: number;
      textRank?: number;
      updatedAt: number;
      accessCount: number;
    }>();

    vectorResults.forEach((result, idx) => {
      combined.set(result.chunkIdx, {
        content: result.content,
        path: result.path,
        vectorRank: idx + 1,
        updatedAt: result.updatedAt,
        accessCount: result.accessCount,
      });
    });

    textResults.forEach((result, idx) => {
      const existing = combined.get(result.chunkIdx);
      if (existing) {
        existing.textRank = idx + 1;
        return;
      }
      combined.set(result.chunkIdx, {
        content: result.content,
        path: result.path,
        textRank: idx + 1,
        updatedAt: result.updatedAt,
        accessCount: result.accessCount,
      });
    });

    const results: SearchResult[] = [];
    for (const [chunkIdx, data] of combined.entries()) {
      const vectorScore =
        data.vectorRank !== undefined
          ? rrfScore(data.vectorRank, this.options.rrfK) * this.options.vectorWeight
          : 0;
      const textScore =
        data.textRank !== undefined
          ? rrfScore(data.textRank, this.options.rrfK) * this.options.textWeight
          : 0;

      const baseScore = vectorScore + textScore;
      const recencyBoost = computeRecencyBoost(data.updatedAt, this.options.recencyHalfLifeDays);
      const accessBoost = computeAccessBoost(data.accessCount, this.options.accessWeight);
      const score = baseScore * recencyBoost * accessBoost;

      if (score < this.options.minScore) continue;

      results.push({
        chunkIdx,
        content: data.content,
        path: data.path,
        score,
        baseScore,
        recencyBoost,
        accessBoost,
        snippet: makeSnippet(data.content),
      });
    }

    results.sort((a, b) => b.score - a.score);
    const trimmed = results.slice(0, request.topK);
    this.store.markAccess(trimmed.map((item) => item.chunkIdx));
    return trimmed;
  }
}
