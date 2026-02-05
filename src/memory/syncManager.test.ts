import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { SyncManager } from './syncManager.js';

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
});
