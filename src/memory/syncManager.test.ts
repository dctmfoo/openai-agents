import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { SyncManager } from './syncManager.js';
import { chunkMarkdown } from './chunker.js';

const makeStore = () => {
  const state = {
    files: new Map<string, { hash: string }>(),
    chunks: new Map<string, Array<{ chunkIdx: number; embedding: number[] }>>(),
    superseded: new Map<number, number | null>(),
    nextChunkIdx: 1,
  };

  return {
    listFiles: () => Array.from(state.files.entries()).map(([path, data]) => ({
      path,
      hash: data.hash,
      updatedAt: 0,
      lastIndexedAt: 0,
    })),
    getFile: (path: string) => {
      const data = state.files.get(path);
      return data ? { path, hash: data.hash, updatedAt: 0, lastIndexedAt: 0 } : null;
    },
    upsertFile: (path: string, hash: string) => {
      state.files.set(path, { hash });
    },
    deleteFile: (path: string) => {
      state.files.delete(path);
    },
    getEmbeddingCache: () => null,
    upsertEmbeddingCache: () => undefined,
    getActiveChunksForPath: (path: string) => {
      const entries = state.chunks.get(path) ?? [];
      return entries.map((entry) => ({
        chunkIdx: entry.chunkIdx,
        chunkId: `${path}:${entry.chunkIdx}`,
        contentHash: 'hash',
        embedding: entry.embedding,
      }));
    },
    insertChunks: (chunks: Array<{ path: string; embedding: number[] }>) => {
      const ids: number[] = [];
      for (const chunk of chunks) {
        const idx = state.nextChunkIdx++;
        ids.push(idx);
        const entries = state.chunks.get(chunk.path) ?? [];
        entries.push({ chunkIdx: idx, embedding: chunk.embedding });
        state.chunks.set(chunk.path, entries);
      }
      return ids;
    },
    supersedeChunks: (chunkIdxs: number[], supersededBy?: number | null) => {
      for (const id of chunkIdxs) {
        state.superseded.set(id, supersededBy ?? null);
      }
    },
    _state: state,
  };
};

const makeStoreWithDuplicateDetection = () => {
  const base = makeStore();
  const chunkIdToIdx = new Map<string, number>();

  return {
    ...base,
    insertChunks: (chunks: Array<{ chunkId: string; path: string; embedding: number[] }>) => {
      // Simulate real SQLite UNIQUE constraint: throw if duplicate chunk_id
      for (const chunk of chunks) {
        if (chunkIdToIdx.has(chunk.chunkId)) {
          throw new Error(`UNIQUE constraint failed: chunks.chunk_id`);
        }
      }

      const ids = base.insertChunks(chunks);
      chunks.forEach((chunk, idx) => {
        chunkIdToIdx.set(chunk.chunkId, ids[idx]);
      });
      return ids;
    },
    insertChunksIgnoreConflicts: (chunks: Array<{ chunkId: string; path: string; embedding: number[] }>) => {
      // Simulate INSERT OR IGNORE: keep existing ids for duplicates.
      const ids: number[] = [];
      for (const chunk of chunks) {
        const existing = chunkIdToIdx.get(chunk.chunkId);
        if (existing !== undefined) {
          ids.push(existing);
          continue;
        }
        const [inserted] = base.insertChunks([chunk]);
        chunkIdToIdx.set(chunk.chunkId, inserted);
        ids.push(inserted);
      }
      return ids;
    },
    _chunkIdToIdx: chunkIdToIdx,
  };
};

const makeStoreWithStableChunkIds = () => {
  const state = {
    files: new Map<string, { hash: string }>(),
    entriesByChunkId: new Map<
      string,
      { chunkIdx: number; chunkId: string; path: string; embedding: number[]; active: boolean }
    >(),
    entriesByIdx: new Map<
      number,
      { chunkIdx: number; chunkId: string; path: string; embedding: number[]; active: boolean }
    >(),
    supersededPairs: [] as Array<{ chunkIdx: number; supersededBy: number | null }>,
    nextChunkIdx: 1,
  };

  return {
    listFiles: () => Array.from(state.files.entries()).map(([path, data]) => ({
      path,
      hash: data.hash,
      updatedAt: 0,
      lastIndexedAt: 0,
    })),
    getFile: (path: string) => {
      const data = state.files.get(path);
      return data ? { path, hash: data.hash, updatedAt: 0, lastIndexedAt: 0 } : null;
    },
    upsertFile: (path: string, hash: string) => {
      state.files.set(path, { hash });
    },
    deleteFile: (path: string) => {
      state.files.delete(path);
    },
    getEmbeddingCache: () => null,
    upsertEmbeddingCache: () => undefined,
    getActiveChunksForPath: (path: string) => {
      return Array.from(state.entriesByChunkId.values())
        .filter((entry) => entry.path === path && entry.active)
        .map((entry) => ({
          chunkIdx: entry.chunkIdx,
          chunkId: entry.chunkId,
          contentHash: 'hash',
          embedding: entry.embedding,
        }));
    },
    insertChunks: (chunks: Array<{ chunkId: string; path: string; embedding: number[] }>) => {
      const ids: number[] = [];
      for (const chunk of chunks) {
        if (state.entriesByChunkId.has(chunk.chunkId)) {
          throw new Error('UNIQUE constraint failed: chunks.chunk_id');
        }
        const chunkIdx = state.nextChunkIdx++;
        const entry = {
          chunkIdx,
          chunkId: chunk.chunkId,
          path: chunk.path,
          embedding: chunk.embedding,
          active: true,
        };
        state.entriesByChunkId.set(chunk.chunkId, entry);
        state.entriesByIdx.set(chunkIdx, entry);
        ids.push(chunkIdx);
      }
      return ids;
    },
    insertChunksIgnoreConflicts: (chunks: Array<{ chunkId: string; path: string; embedding: number[] }>) => {
      const ids: number[] = [];
      for (const chunk of chunks) {
        const existing = state.entriesByChunkId.get(chunk.chunkId);
        if (existing) {
          ids.push(existing.chunkIdx);
          continue;
        }
        const chunkIdx = state.nextChunkIdx++;
        const entry = {
          chunkIdx,
          chunkId: chunk.chunkId,
          path: chunk.path,
          embedding: chunk.embedding,
          active: true,
        };
        state.entriesByChunkId.set(chunk.chunkId, entry);
        state.entriesByIdx.set(chunkIdx, entry);
        ids.push(chunkIdx);
      }
      return ids;
    },
    supersedeChunks: (chunkIdxs: number[], supersededBy?: number | null) => {
      for (const chunkIdx of chunkIdxs) {
        const entry = state.entriesByIdx.get(chunkIdx);
        if (entry) entry.active = false;
        state.supersededPairs.push({ chunkIdx, supersededBy: supersededBy ?? null });
      }
    },
    _state: state,
  };
};

describe('syncManager', () => {
  it('skips unchanged files and supersedes old chunks on change', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'halo-sync-'));
    const scopeId = 'telegram:dm:wags';
    const scopeDir = path.join(rootDir, 'memory', 'scopes');
    await mkdir(scopeDir, { recursive: true });

    const memoryDir = path.join(scopeDir, 'fake');
    await mkdir(memoryDir, { recursive: true });
    const filePath = path.join(memoryDir, 'MEMORY.md');
    await writeFile(filePath, 'alpha beta gamma', 'utf8');

    const store = makeStore();
    const sync = new SyncManager({
      rootDir,
      scopeId,
      vectorStore: store,
      embedder: async (texts) => texts.map(() => [1, 0]),
      scopeDirOverride: memoryDir,
    });

    await sync.sync();
    expect(store._state.files.size).toBe(1);

    await writeFile(filePath, 'delta epsilon zeta', 'utf8');
    await sync.sync();

    expect(store._state.superseded.size).toBeGreaterThan(0);
  });

  it('uses insertChunksIgnoreConflicts to survive duplicate chunk_ids', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'halo-sync-dup-'));
    const scopeId = 'telegram:dm:wags';
    const scopeDir = path.join(rootDir, 'memory', 'scopes');
    await mkdir(scopeDir, { recursive: true });

    const memoryDir = path.join(scopeDir, 'fake');
    await mkdir(memoryDir, { recursive: true });
    const filePath = path.join(memoryDir, 'MEMORY.md');
    await writeFile(filePath, 'alpha beta gamma', 'utf8');

    const store = makeStoreWithDuplicateDetection();
    const sync = new SyncManager({
      rootDir,
      scopeId,
      vectorStore: store,
      embedder: async (texts) => texts.map(() => [1, 0]),
      scopeDirOverride: memoryDir,
    });

    // First sync succeeds
    await sync.sync();
    expect(store._state.files.size).toBe(1);

    // Simulate a partial previous sync: clear the file record so sync retries,
    // but chunk_ids from the first sync are still in the store
    store._state.files.clear();

    // Second sync would crash with UNIQUE constraint on insertChunks,
    // but uses insertChunksIgnoreConflicts instead
    await expect(sync.sync()).resolves.not.toThrow();
  });

  it('keeps unchanged chunk ids active when duplicate inserts resolve to existing ids', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'halo-sync-stable-'));
    const scopeId = 'telegram:dm:wags';
    const scopeDir = path.join(rootDir, 'memory', 'scopes');
    await mkdir(scopeDir, { recursive: true });

    const memoryDir = path.join(scopeDir, 'fake');
    await mkdir(memoryDir, { recursive: true });
    const filePath = path.join(memoryDir, 'MEMORY.md');

    const baseText = Array.from({ length: 120 }, (_, i) => `- line ${i + 1} lorem ipsum`).join('\n') + '\n';
    await writeFile(filePath, baseText, 'utf8');

    const store = makeStoreWithStableChunkIds();
    const sync = new SyncManager({
      rootDir,
      scopeId,
      vectorStore: store,
      embedder: async (texts) =>
        texts.map((text) => {
          let a = 0;
          let b = 0;
          let c = 0;
          for (let i = 0; i < text.length; i += 1) {
            const code = text.charCodeAt(i);
            a = (a + code) % 997;
            b = (b + code * (i + 1)) % 997;
            c = (c + (code ^ (i % 251))) % 997;
          }
          return [a / 997, b / 997, c / 997];
        }),
      scopeDirOverride: memoryDir,
    });

    await sync.sync();

    const updatedText =
      baseText +
      Array.from({ length: 40 }, (_, i) => `- appended line ${i + 1} after first sync`).join('\n') +
      '\n';
    await writeFile(filePath, updatedText, 'utf8');

    await sync.sync();

    const expected = chunkMarkdown({ path: filePath, text: updatedText });
    const expectedIds = new Set(expected.map((chunk) => chunk.id));

    const activeIds = new Set(
      Array.from(store._state.entriesByChunkId.values())
        .filter((entry) => entry.path === filePath && entry.active)
        .map((entry) => entry.chunkId),
    );

    expect(activeIds).toEqual(expectedIds);

    const selfSuperseded = store._state.supersededPairs.filter(
      ({ chunkIdx, supersededBy }) => supersededBy !== null && supersededBy === chunkIdx,
    );
    expect(selfSuperseded).toEqual([]);
  });
});
