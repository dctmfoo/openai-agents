# OpenAI File Search + Telegram Upload Plan (Hybrid Memory)

Status: **Phase 3 hardening implemented + P0 hardening implemented**

## 0) Delivery status (2026-02-06)

### ✅ Implemented

- Telegram `message:document` ingestion path.
- Per-scope registry under `HALO_HOME/file-memory/scopes/<hash>/registry.json`.
- Per-scope OpenAI vector-store creation/reuse.
- Hosted `file_search` tool wiring (dynamic, scope-aware).
- Prime tool-routing instructions for `semantic_search` vs `file_search`.
- `fileMemory` config schema and runtime wiring.
- Phase-3 retention hardening: background cleanup scheduler + dry-run mode + keep-recent/per-scope caps + role-aware presets + manual admin trigger + `/status` visibility.
- Manual retention runs now support metadata filters (`uploadedBy`, `extensions`, `mimePrefixes`, `uploadedAfterMs`, `uploadedBeforeMs`) with per-run skip counters.

### ✅ P0 hardening implemented

- **In-process per-scope upload lock** in `openaiFileIndexer` to avoid duplicate vector-store creation and racey concurrent writes.
- **Retry with exponential backoff** for transient OpenAI failures (429/5xx/network-style errors).
- **Idempotent duplicate upload behavior**: already-completed Telegram file IDs short-circuit to success without re-uploading.
- **Post-download size enforcement** in Telegram adapter (checks actual downloaded byte length, not only metadata).

### ⏳ Pending (next)

- End-to-end live integration tests against real Telegram + OpenAI APIs.
- Richer observability (file-memory metrics/alerts in admin surfaces).

## 1) Goal

Add document retrieval for Telegram uploads using **OpenAI Vector Stores + `file_search`**, while keeping existing chat-memory retrieval in the **local semantic DB**.

### Desired behavior

- **Plain conversation memory** (chat history, daily notes, transcript chunks):
  - stays local (`semantic.db`)
  - queried via existing `semantic_search`
- **Uploaded files** (PDF/doc/etc from Telegram):
  - indexed in OpenAI Vector Store per scope
  - queried via `file_search`

This gives a hybrid model:
- local memory for conversation continuity
- hosted retrieval for file/document Q&A

---

## 2) Why hybrid

### Keep local for chat memory

- existing path already works (`transcripts -> local chunks -> sqlite-vec`)
- stronger local control for conversational history
- no re-platforming of existing semantic memory

### Use OpenAI file search for uploads

- avoids building/maintaining full file parsing/chunking/indexing stack for many formats
- managed retrieval and ranking for document-centric Q&A
- cleaner path for large/heterogeneous documents

---

## 3) Scope boundaries (non-negotiable)

Scope isolation must stay strict:

- DM scope: `telegram:dm:<memberId>`
- Parents group scope: `telegram:parents_group:<chatId>`

For uploaded files:
- one OpenAI vector store per scope
- never attach/reuse a scope’s files in another scope

---

## 4) OpenAI capabilities used

From current SDK (`@openai/agents` + `openai`):

- Hosted tool: `fileSearchTool(vectorStoreIds, options)`
- Vector store APIs:
  - `vectorStores.create(...)`
  - `vectorStores.files.uploadAndPoll(...)` or `createAndPoll(...)`
  - `vectorStores.files.delete(...)`
- Files API:
  - `files.create({ file, purpose: 'assistants' })`
  - `files.delete(fileId)`

Important platform limits/notes to enforce in app policy:
- Files API max file size (platform-level)
- Assistants/file-search-compatible types only
- poll until file indexing status is terminal (`completed` / `failed`)

---

## 5) Telegram ingestion design

## 5.1 Message handling

Extend Telegram adapter beyond `message:text`:

- handle `message:document`
- (optional later) handle `message:photo` as phase-2+

Current implementation point:
- `src/interfaces/telegram/bot.ts`

## 5.2 End-to-end upload flow

1. Receive `message:document`
2. Run existing family/policy checks (`resolveTelegramPolicy`)
3. Validate file metadata:
   - size limit
   - allowed extension/MIME
4. Download bytes from Telegram file endpoint
5. Resolve/create scope vector store
6. Upload/index file to OpenAI vector store (`uploadAndPoll` preferred)
7. Persist local registry (scope->store and file metadata)
8. Reply in chat with success/failure message
9. Log event to `logs/events.jsonl`

## 5.3 Recommended dependencies

- Required:
  - `openai` (direct dependency)
  - existing `grammy`
- Optional:
  - `file-type` (stronger MIME sniffing)
  - `p-limit` (bounded concurrent indexing)

---

## 6) Data model (local control plane)

Add local registry under HALO_HOME (proposed path):

- `HALO_HOME/file-memory/scopes/<scopeHash>/registry.json`

Proposed shape:

```json
{
  "scopeId": "telegram:dm:wags",
  "vectorStoreId": "vs_...",
  "createdAtMs": 0,
  "updatedAtMs": 0,
  "files": [
    {
      "telegramFileId": "...",
      "telegramFileUniqueId": "...",
      "filename": "report.pdf",
      "mimeType": "application/pdf",
      "sizeBytes": 12345,
      "openaiFileId": "file_...",
      "vectorStoreFileId": "vsfile_...",
      "status": "completed",
      "lastError": null,
      "uploadedBy": "memberId",
      "uploadedAtMs": 0
    }
  ]
}
```

Notes:
- this registry is authoritative for scope mapping and lifecycle operations
- OpenAI IDs are treated as external references only

---

## 7) Tool wiring strategy

## 7.1 Keep existing tools

- `semantic_search` (local memory)
- `read_scoped_memory`
- `remember_daily`
- `web_search_call`

## 7.2 Add hosted file search tool dynamically

At run time, if scope has a vector store ID, include:

- `fileSearchTool(vectorStoreId, { ...options })`

Likely integration points:
- `src/tools/toolNames.ts` (new tool name)
- `src/tools/registry.ts` (conditional addition)
- `src/prime/prime.ts` (pass scope file-store info into tool build)

## 7.3 Agent instructions

Update Prime instructions to guide routing:

- use `semantic_search` for prior chats / conversational recall
- use `file_search` for questions about uploaded documents
- use both when user query is ambiguous

---

## 8) Config additions

Extend `HALO_HOME/config.json` schema (proposed):

```json
{
  "fileMemory": {
    "enabled": true,
    "uploadEnabled": true,
    "maxFileSizeMb": 20,
    "allowedExtensions": ["pdf", "txt", "md", "docx", "pptx", "csv", "json", "html"],
    "maxFilesPerScope": 200,
    "pollIntervalMs": 1500,
    "includeSearchResults": false,
    "maxNumResults": 5
  }
}
```

Behavior when disabled:
- upload handler replies with friendly “file memory disabled” message
- `file_search` tool not exposed

---

## 9) Security and safety

- enforce scope isolation in every read/write path
- never expose vector store IDs across scopes
- redact secrets in logs/errors
- child safety policy:
  - optional tighter upload allowlist/size for child role
  - deny uploads in disallowed scopes (same as current chat policy)

---

## 10) Failure handling

Upload/indexing failures should be explicit and non-destructive:

- if upload fails: no registry write
- if vector-store indexing fails: store failure status + error summary
- never claim file is searchable until status is `completed`
- retries should be idempotent via file identifiers

---

## 11) Lifecycle operations

Need explicit operations for maintenance:

- remove one file from scope memory
  - delete from vector store attachment
  - optionally delete OpenAI file object
  - update registry
- purge all uploaded files for scope
  - used by admin/purge flows
- optional TTL/retention cleanup job (phase-3)

---

## 12) Testing plan

## 12.1 Unit tests

- scope registry create/read/update behavior
- upload policy checks (size/type/scope/role)
- tool registry includes `file_search` only when vector store exists

## 12.2 Integration tests (mock OpenAI client)

- document upload happy path -> indexed -> searchable
- upload failure path -> no false-ready state
- scope isolation: file from scope A never searchable in scope B

## 12.3 Regression tests

- transcript/local semantic behavior unchanged
- existing `semantic_search` path still works

---

## 13) Rollout plan

### Phase 1 (MVP) — ✅ shipped
- `message:document` ingestion
- per-scope vector store registry
- dynamic `file_search` tool wiring
- minimal status logging

### P0 hardening — ✅ shipped (current pass)
- per-scope upload serialization lock
- transient OpenAI retry/backoff
- duplicate upload short-circuit (idempotency)
- downloaded-byte-size validation

### Phase 2 — ✅ shipped
- ✅ admin endpoints for file memory status/list/delete/purge
  - `GET /sessions/:scopeId/files`
  - `POST /sessions/:scopeId/files/:fileRef/delete?deleteOpenAIFile=0|1`
  - `POST /sessions/:scopeId/files/purge?deleteOpenAIFiles=0|1`
- ✅ richer user-facing upload progress + failure messages in Telegram
  - progress acknowledgements for download + indexing stages
  - friendlier limit/failure guidance for indexing errors

### Phase 3 — ✅ shipped
- ✅ retention cleanup scheduler + on-demand trigger
  - config: `fileMemory.retention.{enabled,maxAgeDays,runIntervalMinutes,deleteOpenAIFiles,maxFilesPerRun,dryRun,keepRecentPerScope,maxDeletesPerScopePerRun,allowScopeIds,denyScopeIds,policyPreset}`
  - runtime scheduler: periodic stale-file cleanup (global + per-scope caps + role-aware preset/allow/deny scope filters)
  - admin endpoint: `POST /file-retention/run?scopeId=...&dryRun=0|1&uploadedBy=...&extensions=...&mimePrefixes=...&uploadedAfterMs=...&uploadedBeforeMs=...` (loopback-only)
  - `/status` includes `fileRetention` snapshot for ops visibility
- ✅ safety guardrails
  - dry-run mode
  - skip `in_progress` uploads
  - protect newest N files per scope
  - per-scope deletion cap
- ✅ retention policy hardening
  - tuned defaults: `keepRecentPerScope=2`, `policyPreset=exclude_children`
  - preset UX polish: `exclude_children` excludes known child DMs while allowing unknown DMs
- ✅ richer filtering metadata (by uploader/date/type)
  - manual trigger supports `uploadedBy`, `extensions`, `mimePrefixes`, `uploadedAfterMs`, `uploadedBeforeMs`
  - run summary now reports `excludedByUploaderCount`, `excludedByTypeCount`, `excludedByDateCount`

### Phase 4 (optional)
- image/OCR ingestion path
- cross-file citation formatting improvements

---

## 14) Verification checklist

- [ ] Upload a supported file in DM
- [ ] Observe successful indexing message
- [ ] Ask question specific to uploaded file and get grounded answer
- [ ] Ask question about old chat and confirm local semantic recall still works
- [ ] Upload in one scope, verify not retrievable from another scope
- [ ] Delete file and verify retrieval no longer uses it

---

## 15) Implementation notes for this repo

Primary files expected to change:

- `src/interfaces/telegram/bot.ts`
- `src/prime/prime.ts`
- `src/prime/types.ts`
- `src/tools/registry.ts`
- `src/tools/toolNames.ts`
- `src/runtime/haloConfig.ts`
- new module(s), e.g.:
  - `src/files/scopeFileRegistry.ts`
  - `src/files/openaiFileIndexer.ts`
  - `src/files/fileMemoryLifecycle.ts` (Phase 2 admin lifecycle ops)
  - `src/files/fileMemoryRetentionScheduler.ts` (Phase 3 retention scheduler + hardening controls)
  - `src/tools/openaiFileSearchTool.ts` (or inline hosted tool builder)

This plan intentionally keeps existing local semantic memory untouched and adds file-search as an additive capability.
