import { describe, expect, it } from 'vitest';

import { SearchEngine } from './searchEngine.js';

const makeStore = () => {
  return {
    vectorSearch: () => [
      {
        chunkIdx: 1,
        distance: 0.1,
        content: 'alpha',
        path: 'a.md',
        updatedAt: Date.now() - 1000 * 60 * 60 * 24 * 2,
        accessCount: 0,
        lastAccessedAt: null,
      },
      {
        chunkIdx: 2,
        distance: 0.2,
        content: 'beta',
        path: 'b.md',
        updatedAt: Date.now() - 1000 * 60 * 60 * 24 * 10,
        accessCount: 0,
        lastAccessedAt: null,
      },
    ],
    textSearch: () => [
      {
        chunkIdx: 2,
        score: 0.1,
        content: 'beta',
        path: 'b.md',
        updatedAt: Date.now() - 1000 * 60 * 60 * 24 * 10,
        accessCount: 5,
        lastAccessedAt: null,
      },
      {
        chunkIdx: 3,
        score: 0.2,
        content: 'gamma',
        path: 'c.md',
        updatedAt: Date.now() - 1000 * 60 * 60 * 24 * 1,
        accessCount: 0,
        lastAccessedAt: null,
      },
    ],
    markAccess: () => undefined,
  };
};

describe('searchEngine', () => {
  it('fuses vector + text results with RRF', async () => {
    const store = makeStore();
    const engine = new SearchEngine(store, {
      vectorWeight: 0.7,
      textWeight: 0.3,
      rrfK: 60,
      minScore: 0,
      recencyHalfLifeDays: 30,
      accessWeight: 0,
    });

    const results = await engine.search({
      query: 'test',
      embedding: [0, 1, 2],
      topK: 3,
    });

    expect(results.length).toBe(3);
    expect(results[0].chunkIdx).toBe(2);
  });

  it('applies recency boost', async () => {
    const store = makeStore();
    const engine = new SearchEngine(store, {
      vectorWeight: 1,
      textWeight: 0,
      rrfK: 60,
      minScore: 0,
      recencyHalfLifeDays: 1,
      accessWeight: 0,
    });

    const results = await engine.search({
      query: 'test',
      embedding: [0, 1, 2],
      topK: 2,
    });

    expect(results[0].chunkIdx).toBe(1);
  });
});
