export type EmbeddingProvider = {
  name: string;
  embed: (inputs: string[]) => Promise<number[][]>;
};

type EmbedWithFallbackOptions = {
  batchSize?: number;
  maxRetries?: number;
  backoffMs?: number;
  expectedDimensions?: number;
};

type EmbedResult = {
  provider: string;
  vectors: number[][];
};

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BACKOFF_MS = 500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const normalize = (vec: number[]): number[] => {
  let norm = 0;
  for (const v of vec) norm += v * v;
  if (norm === 0) return vec;
  const scale = 1 / Math.sqrt(norm);
  return vec.map((v) => v * scale);
};

const isRateLimitError = (err: unknown): boolean => {
  if (!err || typeof err !== 'object') return false;
  if ('status' in err && (err as { status?: number }).status === 429) return true;
  if ('code' in err && (err as { code?: string }).code === 'rate_limit') return true;
  if ('message' in err && typeof (err as { message?: string }).message === 'string') {
    return (err as { message: string }).message.toLowerCase().includes('rate limit');
  }
  return false;
};

const batchInputs = (inputs: string[], batchSize: number): string[][] => {
  const batches: string[][] = [];
  for (let i = 0; i < inputs.length; i += batchSize) {
    batches.push(inputs.slice(i, i + batchSize));
  }
  return batches;
};

export async function embedWithFallback(
  inputs: string[],
  providers: EmbeddingProvider[],
  options: EmbedWithFallbackOptions = {},
): Promise<EmbedResult> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;

  let lastError: unknown;

  for (const provider of providers) {
    try {
      const batches = batchInputs(inputs, batchSize);
      const vectors: number[][] = [];
      for (const batch of batches) {
        let attempt = 0;
        while (true) {
          try {
            const res = await provider.embed(batch);
            const normalized = res.map((vec) => normalize(vec));
            if (options.expectedDimensions) {
              normalized.forEach((vec) => {
                if (vec.length !== options.expectedDimensions) {
                  throw new Error(
                    `Embedding dimension mismatch (expected ${options.expectedDimensions}, got ${vec.length})`,
                  );
                }
              });
            }
            vectors.push(...normalized);
            break;
          } catch (err) {
            attempt += 1;
            if (!isRateLimitError(err) || attempt > maxRetries) {
              throw err;
            }
            await sleep(backoffMs * attempt);
          }
        }
      }
      return { provider: provider.name, vectors };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError ?? new Error('No embedding providers available');
}

type OpenAIEmbeddingsOptions = {
  apiKey?: string;
  model?: string;
  dimensions?: number;
  apiBaseUrl?: string;
};

export function createOpenAIEmbeddingProvider(options: OpenAIEmbeddingsOptions = {}): EmbeddingProvider {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for OpenAI embeddings');
  }

  const model = options.model ?? 'text-embedding-3-small';
  const apiBaseUrl = options.apiBaseUrl ?? 'https://api.openai.com/v1';

  return {
    name: 'openai',
    embed: async (inputs: string[]) => {
      const payload: Record<string, unknown> = {
        model,
        input: inputs,
      };
      if (options.dimensions) {
        payload.dimensions = options.dimensions;
      }

      const res = await fetch(`${apiBaseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text();
        const err = new Error(`OpenAI embeddings error (${res.status}): ${text}`);
        (err as any).status = res.status;
        throw err;
      }

      const json = (await res.json()) as {
        data?: Array<{ embedding: number[] }>;
      };
      if (!json.data || json.data.length !== inputs.length) {
        throw new Error('OpenAI embeddings response missing data');
      }
      return json.data.map((item) => item.embedding);
    },
  };
}

type GeminiEmbeddingsOptions = {
  apiKey?: string;
  model?: string;
  dimensions?: number;
  apiBaseUrl?: string;
};

export function createGeminiEmbeddingProvider(options: GeminiEmbeddingsOptions = {}): EmbeddingProvider {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is required for Gemini embeddings');
  }

  const model = options.model ?? 'text-embedding-004';
  const apiBaseUrl = options.apiBaseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';

  return {
    name: 'gemini',
    embed: async (inputs: string[]) => {
      const requests = inputs.map((text) => ({
        model: `models/${model}`,
        content: {
          parts: [{ text }],
        },
        ...(options.dimensions ? { outputDimensionality: options.dimensions } : {}),
      }));

      const res = await fetch(`${apiBaseUrl}/models/${model}:batchEmbedContents`, {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ requests }),
      });

      if (!res.ok) {
        const text = await res.text();
        const err = new Error(`Gemini embeddings error (${res.status}): ${text}`);
        (err as any).status = res.status;
        throw err;
      }

      const json = (await res.json()) as {
        embeddings?: Array<{ values?: number[] }>;
      };
      if (!json.embeddings || json.embeddings.length !== inputs.length) {
        throw new Error('Gemini embeddings response missing data');
      }

      return json.embeddings.map((item) => {
        if (!item.values) {
          throw new Error('Gemini embeddings response missing values');
        }
        return item.values;
      });
    },
  };
}
