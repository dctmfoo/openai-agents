import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { TranscriptSyncManager, getLastIndexedOffset } from './transcriptSyncManager.js';
import { hashSessionId } from '../sessions/sessionHash.js';

const SCOPE_ID = 'telegram:dm:wags';

const userLine = (text: string) =>
  JSON.stringify({ type: 'message', role: 'user', content: text });

const assistantLine = (text: string) =>
  JSON.stringify({
    type: 'message',
    role: 'assistant',
    content: [{ type: 'output_text', text, annotations: [], logprobs: [] }],
    status: 'completed',
  });

const writeScopeTranscript = async (rootDir: string, lines: string[]) => {
  const dir = path.join(rootDir, 'transcripts');
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${hashSessionId(SCOPE_ID)}.jsonl`);
  await writeFile(filePath, lines.join('\n') + '\n', 'utf8');
  return filePath;
};

const appendToTranscript = async (rootDir: string, lines: string[]) => {
  const filePath = path.join(rootDir, 'transcripts', `${hashSessionId(SCOPE_ID)}.jsonl`);
  await appendFile(filePath, lines.join('\n') + '\n', 'utf8');
};

const makeStore = () => {
  const meta = new Map<string, string>();
  const inserted: Array<{ chunkId: string; content: string; path: string }> = [];
  const embeddingCache = new Map<string, number[]>();

  return {
    listFiles: () => [],
    getFile: () => null,
    upsertFile: () => undefined,
    deleteFile: () => undefined,
    getEmbeddingCache: (hash: string) => embeddingCache.get(hash) ?? null,
    upsertEmbeddingCache: (hash: string, emb: number[]) => {
      embeddingCache.set(hash, emb);
    },
    getActiveChunksForPath: () => [],
    insertChunks: (chunks: Array<{ chunkId: string; content: string; path: string; embedding: number[] }>) => {
      for (const c of chunks) {
        inserted.push({ chunkId: c.chunkId, content: c.content, path: c.path });
      }
      return chunks.map((_, i) => i + 1);
    },
    supersedeChunks: () => undefined,
    getMetaValue: (key: string) => meta.get(key) ?? null,
    setMetaValue: (key: string, value: string) => {
      meta.set(key, value);
    },
    _meta: meta,
    _inserted: inserted,
    _embeddingCache: embeddingCache,
  };
};

describe('transcriptSyncManager', () => {
  it('indexes new transcript items and advances watermark', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'tsm-'));
    await writeScopeTranscript(rootDir, [
      userLine('I like coffee'),
      assistantLine('Noted!'),
    ]);

    const store = makeStore();
    const embedCalls: string[][] = [];
    const sync = new TranscriptSyncManager({
      rootDir,
      scopeId: SCOPE_ID,
      vectorStore: store,
      embedder: async (texts) => {
        embedCalls.push(texts);
        return texts.map(() => [1, 0, 0]);
      },
    });

    await sync.sync();

    expect(store._inserted.length).toBeGreaterThan(0);
    expect(getLastIndexedOffset(store)).toBe(2);
    expect(embedCalls.length).toBeGreaterThan(0);
  });

  it('skips already-indexed items on second sync', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'tsm-'));
    await writeScopeTranscript(rootDir, [
      userLine('hello'),
      assistantLine('hi'),
    ]);

    const store = makeStore();
    const sync = new TranscriptSyncManager({
      rootDir,
      scopeId: SCOPE_ID,
      vectorStore: store,
      embedder: async (texts) => texts.map(() => [1, 0]),
    });

    await sync.sync();
    const countAfterFirst = store._inserted.length;

    await sync.sync();
    expect(store._inserted.length).toBe(countAfterFirst);
  });

  it('incrementally indexes new lines after first sync', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'tsm-'));
    await writeScopeTranscript(rootDir, [
      userLine('first message'),
      assistantLine('first reply'),
    ]);

    const store = makeStore();
    const sync = new TranscriptSyncManager({
      rootDir,
      scopeId: SCOPE_ID,
      vectorStore: store,
      embedder: async (texts) => texts.map(() => [1, 0]),
    });

    await sync.sync();
    const firstCount = store._inserted.length;
    expect(getLastIndexedOffset(store)).toBe(2);

    await appendToTranscript(rootDir, [
      userLine('second message'),
      assistantLine('second reply'),
    ]);

    await sync.sync();
    expect(store._inserted.length).toBeGreaterThan(firstCount);
    expect(getLastIndexedOffset(store)).toBe(4);
  });

  it('handles missing transcript file gracefully', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'tsm-'));
    const store = makeStore();
    const sync = new TranscriptSyncManager({
      rootDir,
      scopeId: SCOPE_ID,
      vectorStore: store,
      embedder: async (texts) => texts.map(() => [1, 0]),
    });

    await sync.sync();
    expect(store._inserted.length).toBe(0);
    expect(getLastIndexedOffset(store)).toBe(0);
  });

  it('uses embedding cache to avoid redundant API calls', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'tsm-'));
    await writeScopeTranscript(rootDir, [
      userLine('cached content'),
      assistantLine('cached response'),
    ]);

    const store = makeStore();
    let embedCallCount = 0;
    const sync = new TranscriptSyncManager({
      rootDir,
      scopeId: SCOPE_ID,
      vectorStore: store,
      embedder: async (texts) => {
        embedCallCount += texts.length;
        return texts.map(() => [1, 0]);
      },
    });

    await sync.sync();
    const firstCallCount = embedCallCount;
    expect(firstCallCount).toBeGreaterThan(0);

    store._meta.delete('transcript_last_indexed_offset');
    store._meta.delete('transcript_last_indexed_at_ms');
    store._inserted.length = 0;

    await sync.sync();
    expect(embedCallCount).toBe(firstCallCount);
  });

  it('respects maxNewLinesPerSync', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'tsm-'));
    await writeScopeTranscript(rootDir, [
      userLine('msg1'),
      assistantLine('reply1'),
      userLine('msg2'),
      assistantLine('reply2'),
      userLine('msg3'),
      assistantLine('reply3'),
    ]);

    const store = makeStore();
    const sync = new TranscriptSyncManager({
      rootDir,
      scopeId: SCOPE_ID,
      vectorStore: store,
      embedder: async (texts) => texts.map(() => [1, 0]),
      maxNewLinesPerSync: 2,
    });

    await sync.sync();
    expect(getLastIndexedOffset(store)).toBe(2);

    await sync.sync();
    expect(getLastIndexedOffset(store)).toBe(4);

    await sync.sync();
    expect(getLastIndexedOffset(store)).toBe(6);
  });

  it('does not advance watermark when async insert fails', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'tsm-'));
    await writeScopeTranscript(rootDir, [
      userLine('hello'),
      assistantLine('hi'),
    ]);

    const store = {
      ...makeStore(),
      insertChunksIgnoreConflicts: async () => {
        throw new Error('insert failed');
      },
    };

    const sync = new TranscriptSyncManager({
      rootDir,
      scopeId: SCOPE_ID,
      vectorStore: store,
      embedder: async (texts) => texts.map(() => [1, 0]),
    });

    await expect(sync.sync()).rejects.toThrow('insert failed');
    expect(getLastIndexedOffset(store)).toBe(0);
  });
});
