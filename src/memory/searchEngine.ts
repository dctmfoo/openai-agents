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

type SearchCandidate = {
  chunkIdx: number;
  content: string;
  path: string;
  updatedAt: number;
  accessCount: number;
  vectorRank?: number;
  textRank?: number;
};

type CandidatePrefilterHook = (input: {
  request: SearchRequest;
  candidate: SearchCandidate;
}) => boolean;

type NeighborExpansionHook = (input: {
  request: SearchRequest;
  results: SearchResult[];
}) => SearchResult[];

type RerankHook = (input: {
  request: SearchRequest;
  results: SearchResult[];
}) => SearchResult[];

export type SearchEngineOptions = {
  vectorWeight: number;
  textWeight: number;
  rrfK: number;
  minScore: number;
  recencyHalfLifeDays: number;
  accessWeight: number;
  candidatePrefilter?: CandidatePrefilterHook;
  neighborExpansionHook?: NeighborExpansionHook;
  rerankHook?: RerankHook;
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

function toCandidateFromResult(result: SearchResult): SearchCandidate {
  return {
    chunkIdx: result.chunkIdx,
    content: result.content,
    path: result.path,
    updatedAt: Date.now(),
    accessCount: 0,
  };
}

function isCandidateAllowed(
  request: SearchRequest,
  candidate: SearchCandidate,
  prefilter?: CandidatePrefilterHook,
): boolean {
  if (!prefilter) {
    return true;
  }

  return prefilter({ request, candidate });
}

function applyResultPolicyGate(
  request: SearchRequest,
  results: SearchResult[],
  options: SearchEngineOptions,
): SearchResult[] {
  const seen = new Set<number>();
  const allowed: SearchResult[] = [];

  for (const result of results) {
    if (result.score < options.minScore) {
      continue;
    }

    if (seen.has(result.chunkIdx)) {
      continue;
    }

    const candidate = toCandidateFromResult(result);
    const candidateAllowed = isCandidateAllowed(
      request,
      candidate,
      options.candidatePrefilter,
    );

    if (!candidateAllowed) {
      continue;
    }

    seen.add(result.chunkIdx);
    allowed.push(result);
  }

  return allowed;
}

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

    const combined = new Map<number, SearchCandidate>();

    vectorResults.forEach((result, idx) => {
      combined.set(result.chunkIdx, {
        chunkIdx: result.chunkIdx,
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
        chunkIdx: result.chunkIdx,
        content: result.content,
        path: result.path,
        textRank: idx + 1,
        updatedAt: result.updatedAt,
        accessCount: result.accessCount,
      });
    });

    const scored: SearchResult[] = [];

    for (const candidate of combined.values()) {
      const candidateAllowed = isCandidateAllowed(
        request,
        candidate,
        this.options.candidatePrefilter,
      );
      if (!candidateAllowed) {
        continue;
      }

      const vectorScore =
        candidate.vectorRank !== undefined
          ? rrfScore(candidate.vectorRank, this.options.rrfK) * this.options.vectorWeight
          : 0;
      const textScore =
        candidate.textRank !== undefined
          ? rrfScore(candidate.textRank, this.options.rrfK) * this.options.textWeight
          : 0;

      const baseScore = vectorScore + textScore;
      const recencyBoost = computeRecencyBoost(
        candidate.updatedAt,
        this.options.recencyHalfLifeDays,
      );
      const accessBoost = computeAccessBoost(candidate.accessCount, this.options.accessWeight);
      const score = baseScore * recencyBoost * accessBoost;

      if (score < this.options.minScore) {
        continue;
      }

      scored.push({
        chunkIdx: candidate.chunkIdx,
        content: candidate.content,
        path: candidate.path,
        score,
        baseScore,
        recencyBoost,
        accessBoost,
        snippet: makeSnippet(candidate.content),
      });
    }

    scored.sort((a, b) => b.score - a.score);

    const expanded = this.options.neighborExpansionHook
      ? [
          ...scored,
          ...this.options.neighborExpansionHook({
            request,
            results: [...scored],
          }),
        ]
      : scored;

    const expandedSorted = [...expanded].sort((a, b) => b.score - a.score);
    const gatedExpanded = applyResultPolicyGate(request, expandedSorted, this.options);

    const reranked = this.options.rerankHook
      ? this.options.rerankHook({
          request,
          results: [...gatedExpanded],
        })
      : gatedExpanded;

    const gatedFinal = applyResultPolicyGate(request, reranked, this.options);
    const trimmed = gatedFinal.slice(0, request.topK);

    this.store.markAccess(trimmed.map((item) => item.chunkIdx));
    return trimmed;
  }
}
