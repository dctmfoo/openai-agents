import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { hashSessionId } from '../sessions/sessionHash.js';

export type EmbeddingSpec = {
  provider: string;
  model: string;
  dimensions: number;
};

export type VectorStoreConfig = {
  rootDir: string;
  scopeId: string;
  embedding: EmbeddingSpec;
  vecExtensionPath?: string;
};

export type VectorSearchResult = {
  chunkIdx: number;
  distance: number;
  content: string;
  path: string;
  updatedAt: number;
  accessCount: number;
  lastAccessedAt: number | null;
};

export type TextSearchResult = {
  chunkIdx: number;
  score: number;
  content: string;
  path: string;
  updatedAt: number;
  accessCount: number;
  lastAccessedAt: number | null;
};

export type ChunkInsertInput = {
  chunkId: string;
  path: string;
  startLine: number;
  endLine: number;
  content: string;
  contentHash: string;
  tokenCount: number;
  embedding: number[];
};

type SqliteStatement = {
  get: (...params: any[]) => any;
  all: (...params: any[]) => any[];
  run: (...params: any[]) => { lastInsertRowid?: number };
};

type SqliteDb = {
  prepare: (sql: string) => SqliteStatement;
  exec: (sql: string) => void;
  pragma: (sql: string) => void;
  close: () => void;
};

const SCHEMA_VERSION = 1;

export function getScopeIndexPath(rootDir: string, scopeId: string): string {
  const hashed = hashSessionId(scopeId);
  return join(rootDir, 'memory', 'scopes', hashed, 'semantic.db');
}

export function buildSchemaStatements(dimensions: number): string[] {
  return [
    `PRAGMA journal_mode = WAL;`,
    `PRAGMA foreign_keys = ON;`,
    `CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY,
      hash TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      last_indexed_at INTEGER NOT NULL,
      chunk_count INTEGER NOT NULL DEFAULT 0
    );`,
    `CREATE TABLE IF NOT EXISTS chunks (
      chunk_idx INTEGER PRIMARY KEY AUTOINCREMENT,
      chunk_id TEXT NOT NULL UNIQUE,
      path TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      token_count INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      superseded_at INTEGER,
      superseded_by INTEGER,
      access_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at INTEGER,
      embedding_provider TEXT NOT NULL,
      embedding_model TEXT NOT NULL,
      embedding_dimensions INTEGER NOT NULL,
      embedding_json TEXT NOT NULL,
      FOREIGN KEY (superseded_by) REFERENCES chunks(chunk_idx)
    );`,
    `CREATE INDEX IF NOT EXISTS chunks_path_idx ON chunks(path);`,
    `CREATE INDEX IF NOT EXISTS chunks_active_idx ON chunks(superseded_at);`,
    `CREATE TABLE IF NOT EXISTS embedding_cache (
      content_hash TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      embedding_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (content_hash, provider, model, dimensions)
    );`,
    `CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      content,
      path,
      chunk_idx UNINDEXED
    );`,
    `CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(
      chunk_idx INTEGER PRIMARY KEY,
      embedding FLOAT[${dimensions}]
    );`,
  ];
}

export function validateVectorStoreMetadata(
  meta: Record<string, string>,
  embedding: EmbeddingSpec,
): void {
  const provider = meta.embedding_provider;
  const model = meta.embedding_model;
  const dims = meta.embedding_dimensions;

  if (provider && provider !== embedding.provider) {
    throw new Error(`Embedding provider mismatch (db=${provider}, config=${embedding.provider})`);
  }
  if (model && model !== embedding.model) {
    throw new Error(`Embedding model mismatch (db=${model}, config=${embedding.model})`);
  }
  if (dims && Number.parseInt(dims, 10) !== embedding.dimensions) {
    throw new Error(
      `Embedding dimensions mismatch (db=${dims}, config=${embedding.dimensions})`,
    );
  }
}

const ensureDir = (path: string) => {
  mkdirSync(path, { recursive: true });
};

const serializeEmbedding = (embedding: number[]): string => JSON.stringify(embedding);

const parseEmbedding = (raw: string): number[] => JSON.parse(raw) as number[];

export class VectorStore {
  private readonly db: SqliteDb;
  private readonly embedding: EmbeddingSpec;

  private constructor(db: SqliteDb, embedding: EmbeddingSpec) {
    this.db = db;
    this.embedding = embedding;
  }

  static async open(config: VectorStoreConfig): Promise<VectorStore> {
    const dbPath = getScopeIndexPath(config.rootDir, config.scopeId);
    ensureDir(join(config.rootDir, 'memory', 'scopes', hashSessionId(config.scopeId)));

    const db = await openSqliteDb(dbPath, config.vecExtensionPath);
    const store = new VectorStore(db, config.embedding);
    store.ensureSchema();
    store.ensureMetadata();
    return store;
  }

  close() {
    this.db.close();
  }

  private ensureSchema() {
    const statements = buildSchemaStatements(this.embedding.dimensions);
    for (const sql of statements) {
      this.db.exec(sql);
    }
  }

  private ensureMetadata() {
    const meta = this.getMeta();
    if (Object.keys(meta).length === 0) {
      this.setMeta({
        schema_version: String(SCHEMA_VERSION),
        embedding_provider: this.embedding.provider,
        embedding_model: this.embedding.model,
        embedding_dimensions: String(this.embedding.dimensions),
      });
      return;
    }

    validateVectorStoreMetadata(meta, this.embedding);
  }

  private getMeta(): Record<string, string> {
    const rows = this.db.prepare('SELECT key, value FROM meta').all();
    const map: Record<string, string> = {};
    for (const row of rows) {
      if (row?.key && row?.value) {
        map[String(row.key)] = String(row.value);
      }
    }
    return map;
  }

  private setMeta(values: Record<string, string>) {
    const stmt = this.db.prepare(
      'INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    );
    for (const [key, value] of Object.entries(values)) {
      stmt.run(key, value);
    }
  }

  listFiles(): Array<{ path: string; hash: string; updatedAt: number; lastIndexedAt: number }> {
    return this.db
      .prepare('SELECT path, hash, updated_at as updatedAt, last_indexed_at as lastIndexedAt FROM files')
      .all();
  }

  getFile(path: string): { path: string; hash: string; updatedAt: number; lastIndexedAt: number } | null {
    const row = this.db
      .prepare('SELECT path, hash, updated_at as updatedAt, last_indexed_at as lastIndexedAt FROM files WHERE path = ?')
      .get(path);
    return row ?? null;
  }

  upsertFile(path: string, hash: string, updatedAt: number) {
    this.db
      .prepare(
        `INSERT INTO files(path, hash, updated_at, last_indexed_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET
           hash = excluded.hash,
           updated_at = excluded.updated_at,
           last_indexed_at = excluded.last_indexed_at`,
      )
      .run(path, hash, updatedAt, updatedAt);
  }

  deleteFile(path: string) {
    this.db.prepare('DELETE FROM files WHERE path = ?').run(path);
  }

  upsertEmbeddingCache(contentHash: string, embedding: number[]) {
    this.db
      .prepare(
        `INSERT INTO embedding_cache(content_hash, provider, model, dimensions, embedding_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(content_hash, provider, model, dimensions) DO UPDATE SET
           embedding_json = excluded.embedding_json,
           created_at = excluded.created_at`,
      )
      .run(
        contentHash,
        this.embedding.provider,
        this.embedding.model,
        this.embedding.dimensions,
        serializeEmbedding(embedding),
        Date.now(),
      );
  }

  getEmbeddingCache(contentHash: string): number[] | null {
    const row = this.db
      .prepare(
        `SELECT embedding_json FROM embedding_cache
         WHERE content_hash = ? AND provider = ? AND model = ? AND dimensions = ?`,
      )
      .get(contentHash, this.embedding.provider, this.embedding.model, this.embedding.dimensions);
    if (!row?.embedding_json) return null;
    return parseEmbedding(String(row.embedding_json));
  }

  getActiveChunksForPath(path: string): Array<{
    chunkIdx: number;
    chunkId: string;
    contentHash: string;
    embedding: number[];
  }> {
    const rows = this.db
      .prepare(
        `SELECT chunk_idx as chunkIdx, chunk_id as chunkId, content_hash as contentHash, embedding_json as embeddingJson
         FROM chunks
         WHERE path = ? AND superseded_at IS NULL`,
      )
      .all(path);

    return rows.map((row) => ({
      chunkIdx: Number(row.chunkIdx),
      chunkId: String(row.chunkId),
      contentHash: String(row.contentHash),
      embedding: parseEmbedding(String(row.embeddingJson)),
    }));
  }

  insertChunks(chunks: ChunkInsertInput[]): number[] {
    const insertChunk = this.db.prepare(
      `INSERT INTO chunks(
        chunk_id, path, start_line, end_line, content, content_hash, token_count,
        created_at, updated_at, embedding_provider, embedding_model, embedding_dimensions, embedding_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertFts = this.db.prepare(
      `INSERT INTO chunks_fts(chunk_idx, content, path) VALUES (?, ?, ?)`,
    );
    const insertVec = this.db.prepare(
      `INSERT INTO chunks_vec(chunk_idx, embedding) VALUES (?, ?)`,
    );

    const ids: number[] = [];
    for (const chunk of chunks) {
      const now = Date.now();
      const result = insertChunk.run(
        chunk.chunkId,
        chunk.path,
        chunk.startLine,
        chunk.endLine,
        chunk.content,
        chunk.contentHash,
        chunk.tokenCount,
        now,
        now,
        this.embedding.provider,
        this.embedding.model,
        this.embedding.dimensions,
        serializeEmbedding(chunk.embedding),
      );
      const chunkIdx = Number(result.lastInsertRowid);
      ids.push(chunkIdx);

      insertFts.run(chunkIdx, chunk.content, chunk.path);
      insertVec.run(chunkIdx, serializeEmbedding(chunk.embedding));
    }
    return ids;
  }

  supersedeChunks(chunkIdxs: number[], supersededBy?: number | null) {
    if (chunkIdxs.length === 0) return;
    const now = Date.now();
    const placeholders = chunkIdxs.map(() => '?').join(', ');
    this.db
      .prepare(
        `UPDATE chunks SET superseded_at = ?, superseded_by = ?
         WHERE chunk_idx IN (${placeholders})`,
      )
      .run(now, supersededBy ?? null, ...chunkIdxs);

    this.db
      .prepare(`DELETE FROM chunks_vec WHERE chunk_idx IN (${placeholders})`)
      .run(...chunkIdxs);
    this.db
      .prepare(`DELETE FROM chunks_fts WHERE chunk_idx IN (${placeholders})`)
      .run(...chunkIdxs);
  }

  vectorSearch(embedding: number[], limit: number): VectorSearchResult[] {
    const rows = this.db
      .prepare(
        `WITH knn AS (
          SELECT chunk_idx, vec_distance_l2(embedding, ?) as distance
          FROM chunks_vec
          ORDER BY distance ASC
          LIMIT ?
        )
        SELECT knn.chunk_idx as chunkIdx,
               knn.distance as distance,
               chunks.content as content,
               chunks.path as path,
               chunks.updated_at as updatedAt,
               chunks.access_count as accessCount,
               chunks.last_accessed_at as lastAccessedAt
        FROM knn
        JOIN chunks ON chunks.chunk_idx = knn.chunk_idx
        WHERE chunks.superseded_at IS NULL
        ORDER BY knn.distance ASC`,
      )
      .all(serializeEmbedding(embedding), limit);

    return rows.map((row) => ({
      chunkIdx: Number(row.chunkIdx),
      distance: Number(row.distance),
      content: String(row.content),
      path: String(row.path),
      updatedAt: Number(row.updatedAt),
      accessCount: Number(row.accessCount ?? 0),
      lastAccessedAt: row.lastAccessedAt ? Number(row.lastAccessedAt) : null,
    }));
  }

  textSearch(query: string, limit: number): TextSearchResult[] {
    const rows = this.db
      .prepare(
        `SELECT chunk_idx as chunkIdx, bm25(chunks_fts) as score
         FROM chunks_fts
         WHERE chunks_fts MATCH ?
         ORDER BY score
         LIMIT ?`,
      )
      .all(query, limit);

    if (rows.length === 0) return [];
    const ids = rows.map((row) => Number(row.chunkIdx));
    const placeholders = ids.map(() => '?').join(', ');
    const chunkRows = this.db
      .prepare(
        `SELECT chunk_idx as chunkIdx,
                content as content,
                path as path,
                updated_at as updatedAt,
                access_count as accessCount,
                last_accessed_at as lastAccessedAt
         FROM chunks
         WHERE chunk_idx IN (${placeholders}) AND superseded_at IS NULL`,
      )
      .all(...ids);

    const chunkMap = new Map<number, any>();
    for (const row of chunkRows) {
      chunkMap.set(Number(row.chunkIdx), row);
    }

    return rows
      .map((row) => {
        const chunk = chunkMap.get(Number(row.chunkIdx));
        if (!chunk) return null;
        return {
          chunkIdx: Number(row.chunkIdx),
          score: Number(row.score),
          content: String(chunk.content),
          path: String(chunk.path),
          updatedAt: Number(chunk.updatedAt),
          accessCount: Number(chunk.accessCount ?? 0),
          lastAccessedAt: chunk.lastAccessedAt ? Number(chunk.lastAccessedAt) : null,
        };
      })
      .filter(Boolean) as TextSearchResult[];
  }

  markAccess(chunkIdxs: number[]) {
    if (chunkIdxs.length === 0) return;
    const now = Date.now();
    const placeholders = chunkIdxs.map(() => '?').join(', ');
    this.db
      .prepare(
        `UPDATE chunks
         SET access_count = access_count + 1,
             last_accessed_at = ?
         WHERE chunk_idx IN (${placeholders})`,
      )
      .run(now, ...chunkIdxs);
  }
}

async function openSqliteDb(path: string, vecExtensionPath?: string): Promise<SqliteDb> {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(path);
  const resolvedVecPath = vecExtensionPath ?? process.env.SQLITE_VEC_EXT;
  if (!resolvedVecPath) {
    throw new Error(
      'sqlite-vec extension path missing. Set SQLITE_VEC_EXT or pass vecExtensionPath.',
    );
  }
  db.loadExtension(resolvedVecPath);
  return db as unknown as SqliteDb;
}
