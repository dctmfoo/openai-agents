# Semantic Indexing Strategy (Cost, Freshness, Safety)

Status: **In progress** (transcript watermark indexing + scheduler status visibility implemented)

## ADR Summary

| Field | Value |
|---|---|
| Decision | Adopt **hybrid semantic indexing**: background scheduler as primary + bounded query-time catch-up fallback, moving to **incremental transcript-based indexing** with deterministic upserts. |
| Recommended option | **Option C** (below): Hybrid + incremental watermark + idempotent IDs. |
| Scope | Per-scope semantic index (`semantic.db`) for Telegram DM / parents-group scopes. |
| Primary goal | Reduce embedding/indexing cost while keeping retrieval fresh and privacy-safe. |
| Safety invariant | No cross-scope indexing or retrieval. Scope isolation is non-negotiable. |
| Rollout style | Phased migration (Phase 0 → 3), no big-bang rewrite. |

## Options considered

- **Option A — Query-time sync only**
  - Pros: simplest runtime model
  - Cons: user-visible latency spikes, first query after updates is slow, failures happen on request path

- **Option B — Background full-file sync only (current baseline + schedule)**
  - Pros: better query latency than A, simple operations
  - Cons: changed large files still cause extra churn; not truly incremental at event level

- **Option C — Hybrid + incremental + idempotent (recommended)**
  - Pros: best cost/freshness/reliability balance; robust against retries/restarts
  - Cons: slightly more state management (watermark + deterministic IDs)

## Recommendation

Use **Option C**.

Short form:
- Index from transcript deltas (watermark)
- Use deterministic chunk IDs + upserts
- Keep background scheduler as primary sync path
- Keep bounded query fallback for staleness recovery

## Why this doc exists

We need semantic retrieval that is:

1. **Cheap** (don’t re-embed old content repeatedly)
2. **Fresh enough** (new messages become searchable quickly)
3. **Safe** (strict scope isolation; no cross-scope leakage)
4. **Deterministic** (retries/restarts do not duplicate or corrupt index state)

## Current behavior (today)

- Source-of-truth chat data is append-only transcripts under:
  - `HALO_HOME/transcripts/<scopeHash>.jsonl`
- Scoped markdown memory is written under:
  - `HALO_HOME/memory/scopes/<scopeHash>/MEMORY.md`
  - `HALO_HOME/memory/scopes/<scopeHash>/YYYY-MM-DD.md`
- Semantic index is per scope:
  - `HALO_HOME/memory/scopes/<scopeHash>/semantic.db`
- A background scheduler runs semantic sync for active scopes (config-driven via `semanticMemory.syncIntervalMinutes`).
- Sync currently does **file-hash skip**:
  - unchanged markdown file hash => skip indexing
  - changed file hash => re-chunk and reindex that file

### What works well

- Per-scope isolation is strong.
- Unchanged files are skipped (basic cost control).
- On-demand semantic search can still catch up.

### Current limitation

When a markdown file changes, indexing is file-level, not transcript-offset-level. This can still create avoidable churn on large files.

---

## Principles for the next iteration

1. **Canonical source for indexing = transcript stream**
   - Markdown is a human-readable projection, not the primary indexing log.

2. **Idempotent writes via deterministic IDs**
   - Re-running same indexing work should overwrite/update, not duplicate.

3. **Incremental progress via per-scope high-watermark**
   - Only index events newer than `lastIndexedOffset`.

4. **Single-writer per scope**
   - Prevent overlapping jobs for the same scope.

5. **Graceful freshness model**
   - Background indexing is primary.
   - Query-time catch-up is fallback when stale.

---

## Recommended architecture

## 1) Input model

Use transcript items (`transcripts/<scopeHash>.jsonl`) as ingestion input.

Each transcript item should have a stable logical offset for a scope (line number or explicit sequence id).

## 2) Per-scope indexing state

Store in `semantic.db` (or side meta table):

- `last_indexed_offset` (high-watermark)
- `last_indexed_at_ms`
- `index_version` (for future migrations)
- `embedding_provider/model/dimensions`

## 3) Deterministic chunk identity

Each indexed chunk gets a deterministic key, e.g.:

`chunk_id = sha256(scope_id + source_offset + chunk_ordinal + chunk_text_hash)`

Effect:
- retries are safe
- restarts are safe
- no accidental duplicate rows for same chunk version

## 4) Upsert semantics

Upsert by deterministic `chunk_id` (or deterministic integer key mapping) so repeated ingestion overwrites same logical chunk.

## 5) Incremental scheduler

Background scheduler loop:

1. Pick active scope
2. Load `last_indexed_offset`
3. Read transcript items after watermark
4. Chunk + embed only new/changed chunks
5. Upsert index rows
6. Advance watermark **after successful commit**

## 6) Query-time policy

- Default query uses current index immediately.
- If index staleness > threshold (e.g. 120s), optionally run bounded catch-up before query.
- If catch-up fails, return best-effort results + observability signal (don’t crash chat path).

---

## Failure modes and mitigations

1. **Crash after partial writes**
   - Mitigation: watermark advances only after successful write batch.

2. **Duplicate scheduling/retries**
   - Mitigation: deterministic IDs + upsert idempotency.

3. **Out-of-order runs**
   - Mitigation: single in-flight worker per scope; reject stale run tokens.

4. **Embedding outage**
   - Mitigation: keep prior index; retry with backoff; do not block normal chat.

5. **Model/dimension mismatch**
   - Mitigation: metadata guardrail + controlled reindex path.

6. **Scope mix-up (privacy risk)**
   - Mitigation: strict per-scope physical separation; never cross-scope search by default.

---

## Cost-control checklist

- [ ] Skip unchanged items by watermark
- [ ] Skip unchanged text by content hash cache
- [ ] Batch embedding requests
- [ ] Limit catch-up window on query path
- [ ] Track superseded chunk count and compact/GC periodically

---

## Suggested rollout plan

### Phase 0 (current baseline)
- File-hash skip + scheduler + per-scope DB

### Phase 1
- Add transcript high-watermark (`last_indexed_offset`)
- Index only new transcript items

### Phase 2
- Deterministic chunk ID upsert path
- Remove insert-only behavior for equivalent logical chunks

### Phase 3
- Add background GC for superseded chunks
- Add staleness policy knobs + admin visibility

---

## Observability / Admin requirements

Expose in `/status` and admin UI:

- `enabled`
- `intervalMinutes`
- `activeScopeCount`
- `running`
- `totalRuns`
- `totalFailures`
- `lastSuccessAtMs`
- `lastError` (+ scope)

Also recommended per-scope metrics (future):

- watermark position
- lag (items behind)
- chunks upserted per run
- embeddings requested per run

---

## Industry alignment (references)

- Pinecone upsert/overwrite by record ID:  
  <https://docs.pinecone.io/guides/data/upsert-data>
- Qdrant idempotent point APIs:  
  <https://qdrant.tech/documentation/concepts/points/>
- Weaviate deterministic IDs to avoid duplicates:  
  <https://docs.weaviate.io/weaviate/manage-data/create>
- LlamaIndex ingestion cache + duplicate/hash-aware document management:  
  <https://docs.llamaindex.ai/en/stable/module_guides/loading/ingestion_pipeline/>
- Azure AI Search incremental indexing via change tracking/high-watermark:  
  <https://learn.microsoft.com/azure/search/search-how-to-index-sql-database>
- Elasticsearch optimistic concurrency controls against stale writes:  
  <https://www.elastic.co/guide/en/elasticsearch/reference/current/optimistic-concurrency-control.html>

---

## Bottom line

For this repo: **Hybrid + incremental + idempotent** is the target.

- Hybrid freshness (background first, query fallback)
- Incremental by watermark (not full-file rescans)
- Idempotent upserts via deterministic IDs
- Strict scope boundaries as a hard invariant
