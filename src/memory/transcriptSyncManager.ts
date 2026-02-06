import { createHash } from 'node:crypto';
import { readTranscriptAfterOffset } from './transcriptReader.js';
import { chunkTranscriptItems, type TranscriptChunk } from './transcriptChunker.js';
import { hashSessionId } from '../sessions/sessionHash.js';
import type { SyncVectorStore } from './syncManager.js';

type TranscriptIndexState = {
  getMetaValue(key: string): string | null;
  setMetaValue(key: string, value: string): void;
};

type TranscriptSyncManagerOptions = {
  rootDir: string;
  scopeId: string;
  vectorStore: SyncVectorStore & TranscriptIndexState;
  embedder: (texts: string[]) => Promise<number[][]>;
  maxNewLinesPerSync?: number;
};

const DEFAULT_MAX_NEW_LINES = 200;

const META_LAST_OFFSET = 'transcript_last_indexed_offset';
const META_LAST_AT = 'transcript_last_indexed_at_ms';

const sha256 = (text: string): string =>
  createHash('sha256').update(text).digest('hex');

function getLastIndexedOffset(store: TranscriptIndexState): number {
  const raw = store.getMetaValue(META_LAST_OFFSET);
  if (!raw) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function setLastIndexedOffset(store: TranscriptIndexState, offset: number): void {
  store.setMetaValue(META_LAST_OFFSET, String(offset));
  store.setMetaValue(META_LAST_AT, String(Date.now()));
}

class TranscriptSyncManager {
  private readonly options: TranscriptSyncManagerOptions;

  constructor(options: TranscriptSyncManagerOptions) {
    this.options = options;
  }

  async sync(): Promise<void> {
    const { rootDir, scopeId, vectorStore, embedder } = this.options;
    const maxLines = this.options.maxNewLinesPerSync ?? DEFAULT_MAX_NEW_LINES;

    const lastOffset = getLastIndexedOffset(vectorStore);

    const { lines, endOffset } = await readTranscriptAfterOffset(
      rootDir,
      scopeId,
      lastOffset,
      maxLines,
    );

    if (lines.length === 0) return;

    const transcriptPath = `transcripts/${hashSessionId(scopeId)}.jsonl`;

    const chunks = chunkTranscriptItems({
      scopeId,
      path: transcriptPath,
      lines,
    });

    if (chunks.length === 0) {
      setLastIndexedOffset(vectorStore, endOffset);
      return;
    }

    const embeddings = await this.embedChunks(chunks);

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

    for (const entry of inserts) {
      vectorStore.upsertEmbeddingCache(entry.contentHash, entry.embedding);
    }

    const insert = vectorStore.insertChunksIgnoreConflicts ?? vectorStore.insertChunks;
    insert.call(vectorStore, inserts);

    setLastIndexedOffset(vectorStore, endOffset);
  }

  private async embedChunks(chunks: TranscriptChunk[]): Promise<number[][]> {
    const { vectorStore, embedder } = this.options;
    const embeddings: (number[] | null)[] = new Array(chunks.length).fill(null);
    const toEmbed: string[] = [];
    const indicesToFill: number[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const contentHash = sha256(chunks[i].text);
      const cached = vectorStore.getEmbeddingCache(contentHash);
      if (cached) {
        embeddings[i] = cached;
      } else {
        indicesToFill.push(i);
        toEmbed.push(chunks[i].text);
      }
    }

    if (toEmbed.length > 0) {
      const embedded = await embedder(toEmbed);
      if (embedded.length !== toEmbed.length) {
        throw new Error(
          `Embedding API returned ${embedded.length} vectors for ${toEmbed.length} inputs`,
        );
      }
      for (let i = 0; i < embedded.length; i++) {
        embeddings[indicesToFill[i]] = embedded[i];
      }
    }

    return embeddings.map((e, idx) => {
      if (!e) throw new Error(`Missing embedding at index ${idx}`);
      return e;
    });
  }
}

export { TranscriptSyncManager, getLastIndexedOffset };
export type { TranscriptIndexState };
