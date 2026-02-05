import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { hashSessionId } from '../sessions/sessionHash.js';
import { chunkMarkdown } from './chunker.js';

type ActiveChunk = {
  chunkIdx: number;
  chunkId: string;
  contentHash: string;
  embedding: number[];
};

export type SyncVectorStore = {
  listFiles: () => Array<{ path: string; hash: string; updatedAt: number; lastIndexedAt: number }>;
  getFile: (path: string) => { path: string; hash: string; updatedAt: number; lastIndexedAt: number } | null;
  upsertFile: (path: string, hash: string, updatedAt: number) => void;
  deleteFile: (path: string) => void;
  getEmbeddingCache: (contentHash: string) => number[] | null;
  upsertEmbeddingCache: (contentHash: string, embedding: number[]) => void;
  getActiveChunksForPath: (path: string) => ActiveChunk[];
  insertChunks: (chunks: Array<{
    chunkId: string;
    path: string;
    startLine: number;
    endLine: number;
    content: string;
    contentHash: string;
    tokenCount: number;
    embedding: number[];
  }>) => number[];
  supersedeChunks: (chunkIdxs: number[], supersededBy?: number | null) => void;
};

export type SyncManagerOptions = {
  rootDir: string;
  scopeId: string;
  vectorStore: SyncVectorStore;
  embedder: (texts: string[]) => Promise<number[][]>;
  similarityThreshold?: number;
  scopeDirOverride?: string;
};

const DEFAULT_SIMILARITY_THRESHOLD = 0.9;

const sha256 = (text: string): string => {
  return createHash('sha256').update(text).digest('hex');
};

const cosineSimilarity = (a: number[], b: number[]): number => {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

const getScopeDir = (rootDir: string, scopeId: string) => {
  const hashed = hashSessionId(scopeId);
  return join(rootDir, 'memory', 'scopes', hashed);
};

const listMarkdownFiles = async (dir: string): Promise<string[]> => {
  try {
    const entries = await readdir(dir);
    return entries
      .filter((entry) => entry.toLowerCase().endsWith('.md'))
      .map((entry) => join(dir, entry));
  } catch {
    return [];
  }
};

export class SyncManager {
  private readonly options: SyncManagerOptions;

  constructor(options: SyncManagerOptions) {
    this.options = options;
  }

  async sync(): Promise<void> {
    const scopeDir = this.options.scopeDirOverride ?? getScopeDir(this.options.rootDir, this.options.scopeId);
    const files = await listMarkdownFiles(scopeDir);
    const fileSet = new Set(files);
    const existing = this.options.vectorStore.listFiles();

    for (const file of existing) {
      if (!fileSet.has(file.path)) {
        const active = this.options.vectorStore.getActiveChunksForPath(file.path);
        const ids = active.map((chunk) => chunk.chunkIdx);
        this.options.vectorStore.supersedeChunks(ids, null);
        this.options.vectorStore.deleteFile(file.path);
      }
    }

    for (const path of files) {
      const contents = await readFile(path, 'utf8');
      const hash = sha256(contents);
      const info = this.options.vectorStore.getFile(path);
      if (info && info.hash === hash) {
        continue;
      }

      await this.indexFile(path, contents);
      const updatedAt = (await stat(path)).mtimeMs;
      this.options.vectorStore.upsertFile(path, hash, updatedAt);
    }
  }

  private async indexFile(path: string, contents: string) {
    const chunks = chunkMarkdown({ path, text: contents });
    const embeddings: number[][] = [];
    const toEmbed: string[] = [];
    const indicesToFill: number[] = [];

    chunks.forEach((chunk, idx) => {
      const contentHash = sha256(chunk.text);
      const cached = this.options.vectorStore.getEmbeddingCache(contentHash);
      if (cached) {
        embeddings[idx] = cached;
      } else {
        indicesToFill.push(idx);
        toEmbed.push(chunk.text);
      }
    });

    if (toEmbed.length > 0) {
      const embedded = await this.options.embedder(toEmbed);
      embedded.forEach((vector, i) => {
        const chunkIdx = indicesToFill[i];
        embeddings[chunkIdx] = vector;
      });
    }

    const oldChunks = this.options.vectorStore.getActiveChunksForPath(path);

    const inserts = chunks.map((chunk, idx) => ({
      chunkId: chunk.id,
      path: chunk.path,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      content: chunk.text,
      contentHash: sha256(chunk.text),
      tokenCount: chunk.tokenEstimate,
      embedding: embeddings[idx],
    }));

    inserts.forEach((entry) => {
      this.options.vectorStore.upsertEmbeddingCache(entry.contentHash, entry.embedding);
    });

    const newChunkIdxs = this.options.vectorStore.insertChunks(inserts);
    const similarityThreshold = this.options.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
    const supersedeMap = new Map<number, number | null>();

    for (const oldChunk of oldChunks) {
      let best: { idx: number; score: number } | null = null;
      for (let index = 0; index < newChunkIdxs.length; index++) {
        const newIdx = newChunkIdxs[index];
        const similarity = cosineSimilarity(oldChunk.embedding, embeddings[index]);
        if (!best || similarity > best.score) {
          best = { idx: newIdx, score: similarity };
        }
      }
      if (best !== null && best.score >= similarityThreshold) {
        supersedeMap.set(oldChunk.chunkIdx, best.idx);
      } else {
        supersedeMap.set(oldChunk.chunkIdx, null);
      }
    }

    const grouped: Map<number | null, number[]> = new Map();
    for (const [oldIdx, newIdx] of supersedeMap.entries()) {
      const list = grouped.get(newIdx ?? null) ?? [];
      list.push(oldIdx);
      grouped.set(newIdx ?? null, list);
    }

    for (const [newIdx, oldIdxs] of grouped.entries()) {
      this.options.vectorStore.supersedeChunks(oldIdxs, newIdx);
    }
  }
}
