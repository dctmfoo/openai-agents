# Project Overview

> **Main project tracking document** — Last updated: 2026-02-06

## What is openai-agents?

A **family-first AI companion** called "Prime" (codename "Halo") built with the **OpenAI Agents SDK (TypeScript)**. A shared family assistant with privacy boundaries — parents have their own space, kids have theirs, and nothing leaks between them.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Agent SDK** | `@openai/agents` v0.4.4 (OpenAI's official SDK) |
| **Runtime** | TypeScript + Node.js |
| **Interfaces** | Telegram (grammY), CLI, Gateway HTTP server |
| **Admin UI** | Tauri v2 desktop app (Vite) |
| **Session Storage** | FileBackedSession (JSONL files) |
| **Memory** | Scoped markdown memory + sqlite-vec semantic index |
| **Validation** | Zod |
| **Testing** | Vitest |
| **Compaction** | OpenAI Responses API `/responses/compact` |

---

## Current Features (What's Built)

### ✅ Core
- **Prime agent** — main conversational AI
- **Telegram bot** — DMs + parents-only group chat
- **CLI** — local testing (`pnpm dev:cli "..."`)
- **Gateway server** — HTTP admin API on port 8787
- **Tool framework** — deny-by-default registry with hosted web search + scoped memory tools + semantic search tool

### ✅ Privacy & Scopes
- **Scoped conversations** — DM facts stay private, group facts shared among parents
- **Family config** — `family.json` defines members, roles, Telegram IDs
- **Unknown user blocking** — won't engage with strangers
- **Child-safe mode** — child-only prompt + output filtering + guarded memory access + parent transcript access (opt-in)

### ✅ Memory System
- **Scoped memory** — `HALO_HOME/memory/scopes/<hash>/`
- **Durable facts** → `MEMORY.md` (preferences, relationships)
- **Temporal notes** → `YYYY-MM-DD.md` (daily log)
- **Context loading** — SOUL.md + USER.md + scoped memory into Prime
- **Semantic memory layer** — sqlite-vec + FTS5 hybrid search with composite sync (markdown + transcript chunks) per scope
- **Background semantic sync scheduler** — periodic sync for active scopes (`semanticMemory.syncIntervalMinutes`), exposed in `/status` and admin UI

### ✅ Session Management
- **FileBackedSession** — JSONL persistence
- **Compaction** — keeps long conversations manageable via OpenAI API
- **Transcripts** — append-only under `HALO_HOME/transcripts/`

### ✅ Memory Distillation (M5-M6 Complete)
- **Deterministic distillation** — rule-based, no LLM calls
- Patterns: `remember X`, `my X is Y` → durable facts
- **LLM distillation (optional)** — nuanced extraction with `distillationMode: "llm"`
- **Triggers**: every N items (default 20) or manual admin command
- **Failure handling**: exponential backoff (30s → 10min cap)

### ✅ Admin Server
- `/healthz`, `/status`, `/sessions`, `/sessions-with-counts`, `/policy/status`
- `/status` now includes semantic sync scheduler health/snapshot
- `POST /sessions/:scopeId/distill` — manual distillation trigger
- `POST /sessions/:scopeId/clear` — clear session state
- `POST /sessions/:scopeId/purge?confirm=:scopeId` — purge session + transcript (loopback-only)
- Loopback-only diagnostics: `/events/tail`, `/transcripts/tail`

---

## Near-term roadmap

### Current focus
- **Hybrid file memory**: add OpenAI Vector Store + `file_search` path for Telegram file uploads while keeping local semantic chat memory.
- **Admin UX**: improve semantic sync visibility and operational controls.
- **Behavior evals**: add repeatable prompt/eval harness to prevent regressions.

### Backlog (documented/proposed)
- Audit/observability — richer distillation and indexing journals.
- Cost/safety guardrails — cap indexing and model usage per scope.
- Batch operations — scope-wide distill/sync with progress.
- Voice support — Telegram voice transcription + optional TTS.
- Node abstraction — device/account boundaries (not implemented).

---

## Feature Status Matrix

| Feature | Status | Notes |
|---------|--------|-------|
| Core chat | ✅ Working | Prime responds via Telegram/CLI |
| Scoped memory | ✅ Working | Per-user/per-group isolation |
| Deterministic distillation | ✅ Working | Rule-based fact extraction |
| LLM distillation | ✅ Working | Optional mode in config |
| Session compaction | ✅ Working | Via OpenAI Responses API |
| Semantic search | ✅ Working | Local sqlite-vec + FTS hybrid retrieval |
| Transcript incremental indexing | ✅ Working | Watermark-based transcript chunk indexing |
| Background semantic sync | ✅ Working | Active-scope scheduler + `/status` snapshot |
| Admin server + Tauri status | ✅ Working | Includes semantic sync card + session controls |
| Tool framework | ✅ Working | Deny-by-default policy + web/scoped/semantic tools |
| Evals harness | 🟡 Planned | Documented direction, limited automation today |
| Multi-model runtime | ❌ OpenAI primary | OpenAI/Gemini embeddings exist; broader model routing pending |
| Proactive notifications | ❌ Reactive only | No scheduled proactive messaging yet |
| Voice | ❌ Not implemented | Planned |

---

## Directory Structure

```
openai-agents/
├── src/
│   ├── gateway/          # Gateway runtime + admin endpoints
│   ├── interfaces/
│   │   ├── telegram/     # Telegram bot (grammY)
│   │   └── cli/          # CLI runner
│   ├── memory/           # Memory distillation, scoped storage
│   ├── sessions/         # FileBackedSession, compaction
│   ├── runtime/          # Config loading (haloConfig, familyConfig)
│   ├── prime/            # Prime agent orchestration
│   ├── dev/              # Dev tools (todoCheck, complexity, etc.)
│   └── utils/            # Logging utilities
├── apps/admin/           # Tauri v2 admin app
├── config/               # Example configs
├── docs/                 # Architecture, setup, roadmap
├── memory/               # Repo-local daily logs (CLI-only)
├── logs/                 # Runtime logs (gitignored)
├── SOUL.md               # Prime's personality/identity
├── USER.md               # User context
└── MEMORY.md             # Long-term memory
```

---

## Key Files

| File | Purpose |
|------|---------|
| `config/family.example.json` | Family member definitions |
| `config/halo.example.json` | Gateway + feature config |
| `SOUL.md` | Prime's core personality |
| `USER.md` | User-specific context |
| `docs/08-roadmap.md` | Milestone tracking |
| `docs/13-semantic-indexing-strategy.md` | Transcript + semantic indexing design |
| `docs/14-openai-file-search-telegram-upload-plan.md` | Planned hybrid file-search ingestion design |

---

## Running the Project

```bash
# Development (Telegram)
pnpm dev:telegram

# Development (CLI)
pnpm dev:cli "Hello Prime"

# Production (Gateway)
pnpm build && pnpm start:gateway

# Tests
pnpm test
```

---

## Related Documents

- [Vision](00-vision.md) — Project goals and non-goals
- [Scope](01-scope.md) — What's in/out for v1
- [Telegram Setup](02-telegram-setup.md) — Bot configuration
- [Architecture](03-architecture.md) — Technical deep-dive
- [Configuration](04-config.md) — Config file reference
- [Policies](05-policies.md) — Access control rules
- [Onboarding](06-onboarding.md) — First-run guide
- [Roadmap](08-roadmap.md) — Milestone tracking
- [Tools](12-tools.md) — Tool registration guide
- [Semantic indexing strategy](13-semantic-indexing-strategy.md) — Incremental transcript indexing design
- [OpenAI file search + Telegram upload plan](14-openai-file-search-telegram-upload-plan.md) — Hybrid file-memory implementation plan
- [Troubleshooting](11-troubleshooting.md) — Common fixes

---

*This document is the main project tracking reference. Keep it updated as features ship.*
