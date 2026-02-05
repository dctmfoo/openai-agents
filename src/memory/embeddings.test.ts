import { describe, expect, it, vi } from 'vitest';

import { embedWithFallback, type EmbeddingProvider } from './embeddings.js';

describe('embeddings', () => {
  it('falls back to secondary provider on rate limit', async () => {
    const primary: EmbeddingProvider = {
      name: 'primary',
      embed: vi.fn().mockRejectedValue({ status: 429, message: 'rate limit' }),
    };
    const secondary: EmbeddingProvider = {
      name: 'secondary',
      embed: vi.fn().mockResolvedValue([[1, 2, 3]]),
    };

    const res = await embedWithFallback(['hello'], [primary, secondary], {
      maxRetries: 1,
      backoffMs: 1,
    });

    expect(primary.embed).toHaveBeenCalled();
    expect(secondary.embed).toHaveBeenCalled();
    expect(res.vectors.length).toBe(1);
    expect(res.vectors[0].length).toBe(3);
    expect(res.provider).toBe('secondary');
  });

  it('batches inputs', async () => {
    const provider: EmbeddingProvider = {
      name: 'primary',
      embed: vi.fn().mockImplementation(async (inputs: string[]) => {
        return inputs.map((_, idx) => [idx + 1]);
      }),
    };

    const res = await embedWithFallback(['a', 'b', 'c', 'd'], [provider], {
      batchSize: 2,
    });

    expect(provider.embed).toHaveBeenCalledTimes(2);
    expect(res.vectors.length).toBe(4);
  });
});
