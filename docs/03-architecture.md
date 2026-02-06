# Architecture (Family-first Companion)

This repo implements a **family-first AI companion** built with the **OpenAI Agents SDK (TypeScript)**.

Design priorities:
- **Family-first**: multiple humans, clear privacy boundaries.
- **Telegram-first**: private DMs + parents-only group.
- **SDK-patterns-first**: Sessions, compaction, tools, guardrails.
- **Portability**: plan for a Node abstraction so core can stay an orchestrator (not implemented yet).

## 1) Core concepts

### Member
A human in the family.

- `memberId`: stable identifier (e.g. `wags`, `mom`, `aarav`)
- `role`: `parent` | `child`

### Scope
A conversation context (a chat thread) with its own session and policy.

- `scopeId`: stable per chat (Telegram chat id)
- `scopeType`: `dm` | `parents_group` | (future: `family_group`, `subgroup`)

### Speaker vs Target
For every incoming message:
- **speaker**: who wrote the message (Telegram `from.id` → member)
- **scope**: where it was written (Telegram `chat.id` → scope)
- **target**: who the request is about (defaults to speaker; may be overridden by explicit intent)

### Node (planned)
A Node represents a **device/account boundary** that owns data and executes actions for a member.

This is not implemented yet. There is a `config/nodes.example.json`, but the runtime does not load or use nodes today.

## 2) Supported conversation scopes

### 2.1 Direct messages (DM)
- One member ↔ halo.
- Session and memory are **private** to that member by default.

### 2.2 Parents-only group (default group mode)
- A Telegram group chat containing only parents + halo.
- All messages in this scope are visible to all parents.

Decisions:
- Child accounts **must not** be in this group.
- If a child is present, the group must not be configured/approved.

## 3) Identity, onboarding, and trust

### 3.1 Unknown user DMs
Decision:
- If an unknown Telegram user DMs halo, halo **does not engage** beyond a short message and asks them to contact a parent to be invited.

### 3.2 Approving a parents-only group
Group chats are **untrusted by default**.

A parents-only group becomes active only when `parentsGroup.telegramChatId` is set in the family config. The system does not query Telegram for group membership; it only checks sender roles from the family config.

## 4) Data model (high level)

We separate:

1) **Conversation state** (for continuing a chat)
- Stored via Agents SDK **Sessions**.
- Compacted via `/responses/compact` (through `OpenAIResponsesCompactionSession`) when using Responses models.

2) **Memory files** (for human-readable long-term and temporal notes)
- Stored as markdown on disk.
- Not committed to git.
- Updated by a memory distillation process.
- Prime loads `SOUL.md`, `USER.md`, scoped `MEMORY.md`, and scoped daily notes (today + yesterday) into context.

3) **Logs / audit**
- Append-only logs for debugging and safety.

## 5) Conversation state (Agents SDK)

We use:
- `FileBackedSession` (local JSONL-backed session persistence)
- `OpenAIResponsesCompactionSession` wrapper to keep long-running sessions small (when `compactionEnabled: true` in config)

Notes:
- Raw transcripts are append-only JSONL files under `HALO_HOME/transcripts` (source of truth).
- Derived session state (summaries/compactions) is stored separately under `HALO_HOME/sessions`.
- Compaction is handled by `OpenAIResponsesCompactionSession` via `/responses/compact` and writes a compaction item into the derived session state. Raw transcripts remain append-only and unchanged; exact replacement behavior is SDK-defined.
- When `distillationEnabled: true`, sessions are additionally wrapped by `DistillingTranscriptSession` which triggers memory distillation after every N items.

## 5a) Semantic memory indexing

Semantic retrieval is per-scope and uses sqlite-vec + FTS5 in `HALO_HOME/memory/scopes/<scopeHash>/semantic.db`.

Current sync strategy combines two ingestion paths:
- **Markdown sync**: hash-based sync of scoped markdown files (`MEMORY.md`, daily notes)
- **Transcript sync**: incremental transcript indexing from append-only JSONL using a per-scope watermark (`transcript_last_indexed_offset`)

Runtime behavior:
- Gateway/telegram runtime starts a background scheduler (`semanticMemory.syncIntervalMinutes`) for active scopes.
- `/status` includes scheduler health (runs, failures, last success/error).
- Admin UI shows this snapshot in a dedicated semantic sync status card.

## 6) Memory distillation (durable vs temporal)

We keep memory files separate from session state.

### Default privacy rule
Decision:
- DM facts stay private to that member.
- Parents-group facts are shared among parents.
- No automatic promotion from DM → parents-group. Sharing must be explicit.

Distillation outputs:
- **durable facts** (stable preferences via "remember X" or "my X is Y" patterns) → `MEMORY.md`
- **temporal notes** (everything else) → `YYYY-MM-DD.md`

Separately, the Telegram adapter appends lightweight `[user]` / `[prime]` lines to the scoped daily file for a quick per-day transcript.

Distillation triggers:
- **Every N items** (configurable via `distillationEveryNItems`, default 20)
- **Manual admin command** (`POST /sessions/:scopeId/distill`)

Distillation is currently **deterministic** (rule-based, no model calls). Patterns recognized:
- `remember X` or `note X` → durable fact
- `my <key> is <value>` → durable fact
- Everything else → temporal daily note

### Distillation failure handling
If distillation fails, the system applies exponential backoff per scope:
- Base: 30 seconds
- Cap: 10 minutes
- Failures are logged to console; the chat loop is never blocked.

## 6a) Admin Server + UI (Tauri)

The gateway exposes an HTTP admin API. The desktop admin app (Tauri) consumes it.

Default gateway base is `http://127.0.0.1:8787` (override with `?gateway=` in the admin URL).

### Public endpoints (any client)

- `GET /healthz` — lightweight health check, returns `{ ok: true }`
- `GET /status` — uptime, version, haloHome paths, config snapshot, semantic sync scheduler status
- `GET /sessions` — scope id strings (legacy shape)
- `GET /sessions-with-counts` — `{ scopeId, itemCount }` objects
- `GET /policy/status` — per-scope allow/deny decisions (with reasons)

### Session control endpoints

- `POST /sessions/:scopeId/clear` — clears derived session state (keeps transcript)
- `POST /sessions/:scopeId/distill` — triggers deterministic distillation for scope (fails if `distillationEnabled: false`)
- `POST /sessions/:scopeId/purge?confirm=:scopeId` — deletes session + transcript (loopback-only + explicit confirm)

### Loopback-only diagnostics (127.0.0.1 only)

- `GET /events/tail?lines=N` — tail of `HALO_HOME/logs/events.jsonl`
- `GET /transcripts/tail?scopeId=...&lines=N` — tail of transcript for scope

## 7) Security boundaries (summary)

- Treat all chat text as untrusted input.
- Enforce permissions outside prompts (policy-as-code).
- No node abstraction yet; tools are built-in and global.
- Avoid storing secrets in plaintext memory; daily note appenders redact obvious tokens (long-term facts do not add extra sanitization yet).

## 8) Portability / transfer

We plan for:
- exporting a family workspace (configs + memory files + audit logs)
- re-attaching nodes to a new core
- revoking a node

We will keep this manual-first (explicit export/import) until later.

## 9) Testing strategy

- TDD by default.
- Deterministic unit tests for:
  - config validation
  - scope/member resolution
  - memory distillation routing rules
  - policy decisions (allow/deny)
- Behavioral evals later for tone and memory quality.
