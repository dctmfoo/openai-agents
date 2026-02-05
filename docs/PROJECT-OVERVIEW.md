# Project Overview

> **Main project tracking document** — Last updated: 2026-02-04

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
| **Memory** | Markdown files (scoped per user/group) |
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
- **Tool framework** — deny-by-default registry with SDK hosted tools + scoped memory tools

### ✅ Privacy & Scopes
- **Scoped conversations** — DM facts stay private, group facts shared among parents
- **Family config** — `family.json` defines members, roles, Telegram IDs
- **Unknown user blocking** — won't engage with strangers

### ✅ Memory System
- **Scoped memory** — `HALO_HOME/memory/scopes/<hash>/`
- **Durable facts** → `MEMORY.md` (preferences, relationships)
- **Temporal notes** → `YYYY-MM-DD.md` (daily log)
- **Context loading** — SOUL.md + USER.md + scoped memory into Prime

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
- `/healthz`, `/status`, `/sessions`, `/policy/status`
- `POST /sessions/:scopeId/distill` — manual distillation trigger
- `POST /sessions/:scopeId/clear` — clear session state
- Loopback-only: `/events/tail`, `/transcripts/tail`

---

## Planned Features (Per Docs)

### M7: Boundary-first Tool Policy (Current Milestone)
- Tools remain deny-by-default
- Add safe read-only tools with explicit scope constraints

### Later (Documented)
- Better onboarding (unknown DM flow)
- Richer Prime behavior + sub-agents-as-tools
- Evals harness for behavior regressions

### Backlog (Proposed)
- Audit/observability — distillation journal (JSONL)
- Cost/safety guardrails — cap input size, runs-per-day
- Incremental distillation — cursor-based, only new items
- Batch distill — "distill all scopes" with progress
- Node abstraction — device/account boundaries (not implemented)

---

## Recommended Features (Priority Order)

### 🔴 High Priority

#### 1. LLM-based Distillation Option (Implemented)
- Optional LLM distillation for nuanced fact extraction
- Flag: `distillationMode: "deterministic" | "llm"`

#### 2. Tool Framework
- No tools implemented yet — Prime can only chat
- Add: calendar read, reminders, web search, file read
- Keep deny-by-default, require explicit scope permissions

#### 3. Child-Safe Mode
- Stricter guardrails when `role: child`
- Content filtering, no access to parents-group context
- Parental visibility into child conversations (opt-in)

### 🟡 Medium Priority

#### 4. Semantic Memory Layer
- Current: grep/read markdown files
- Add: embeddings + vector search for better retrieval
- SQLite + sqlite-vec for vector storage

#### 5. Multi-Model Support
- Currently locked to OpenAI
- Add Anthropic Claude as alternative (for when OpenAI is down)

#### 6. Notification/Proactive System
- Prime can only respond, not initiate
- Add: scheduled check-ins, reminders, morning briefings

#### 7. Voice Messages
- Telegram supports voice — add transcription (Whisper)
- Optional TTS for responses

### 🟢 Nice to Have

#### 8. Cross-Scope Sharing (Explicit)
- "Share this with the family" command
- Promotes DM fact to parents-group scope

#### 9. Mobile-Friendly Admin
- Tauri is desktop-only
- Add simple web dashboard or Telegram admin commands

#### 10. Evals Pipeline
- Documented but not built
- Add LLM-as-judge for tone, helpfulness, memory accuracy

---

## Feature Status Matrix

| Feature | Status | Notes |
|---------|--------|-------|
| Core chat | ✅ Working | Prime responds via Telegram/CLI |
| Scoped memory | ✅ Working | Per-user, per-group isolation |
| Deterministic distillation | ✅ Working | Rule-based fact extraction |
| Session compaction | ✅ Working | Via OpenAI Responses API |
| Admin server | ✅ Working | HTTP API on port 8787 |
| Tools | 🟡 In progress | Framework + scoped memory + hosted web search |
| LLM distillation | ✅ Working | Optional mode in config |
| Semantic search | ❌ Not implemented | Recommended |
| Evals | ❌ Planned only | Documented but not built |
| Multi-model | ❌ OpenAI only | Recommended |
| Proactive/notifications | ❌ Reactive only | Recommended |
| Voice | ❌ Not implemented | Nice to have |

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
- [Roadmap](08-roadmap.md) — Milestone tracking

---

*This document is the main project tracking reference. Keep it updated as features ship.*
