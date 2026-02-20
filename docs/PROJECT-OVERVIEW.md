# Project Overview

> **Main project tracking document** — Last updated: 2026-02-19

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
| **Memory** | Lane-based memory (v2) + sqlite-vec semantic index |
| **Policy Engine** | v2 Control Plane — DecisionEnvelope pipeline |
| **Validation** | Zod |
| **Testing** | Vitest |
| **Compaction** | OpenAI Responses API `/responses/compact` |

---

## Current Features (What's Built)

### ✅ Core
- **Prime agent** — main conversational AI
- **Telegram bot** — DMs + parents-only group chat + family group chat
- **CLI** — local testing (`pnpm dev:cli "..."`)
- **Gateway server** — HTTP admin API on port 8787
- **Tool framework** — deny-by-default registry with hosted web search + lane memory tools + semantic search tool

### ✅ v2 Control Plane
- **`control-plane.json`** — primary configuration path (schemaVersion 2)
- **Profile system** — named profiles (`parent_default`, `young_child`, `adolescent`) map members to capability tiers, memory lane policies, model policies, and safety policies
- **DecisionEnvelope pipeline** — 5-step policy evaluation: safety → scope → role_profile → overrides → compatibility
- **`family_group` scope** — whole-family Telegram group with mention-gating behavior
- **Per-member model selection** — `modelPolicies` map drives model/tier per profile
- **Onboarding contract** — `bootstrapParentOnboarding` + `/onboard join` Telegram commands

### ✅ Privacy & Scopes
- **Scoped conversations** — DM facts stay private; parents-group facts shared among parents; family-group facts shared across household
- **`family_group` scope** — whole-family group chat; Prime only responds when mentioned
- **Family config** — `control-plane.json` (v2) or `family.json` (v1 legacy) defines members, roles, Telegram IDs
- **Unknown user blocking** — won't engage with strangers
- **Child-safe mode** — child-only prompt + output filtering + guarded memory access + parent transcript access (opt-in)
- **DecisionEnvelope** — every request produces a typed decision with action, capabilities, memory lanes, model plan, and safety plan

### ✅ Memory System (Lane-Based)
- **Lane memory** — named lanes replace flat scoped memory:
  - `parent_private:<memberId>` — private to each parent
  - `parents_shared` — shared among all parents
  - `child_private:<memberId>` — private to each child
  - `child_shared` — shared among children
  - `family_shared` — household-wide
- **`allowedMemoryReadLanes` / `allowedMemoryWriteLanes`** — per-request lanes determined by DecisionEnvelope
- **Lane topology** — `memoryLanePolicies` in control-plane.json configures read/write lanes per profile
- **Durable facts** → `MEMORY.md` (preferences, relationships)
- **Temporal notes** → `YYYY-MM-DD.md` (daily log)
- **Context loading** — SOUL.md + USER.md + lane memory into Prime
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
- `/status` now includes semantic sync + file-retention scheduler health/snapshots
- `POST /sessions/:scopeId/distill` — manual distillation trigger
- `POST /sessions/:scopeId/clear` — clear session state
- `POST /sessions/:scopeId/purge?confirm=:scopeId` — purge session + transcript (loopback-only)
- Loopback-only diagnostics: `/events/tail`, `/transcripts/tail`
- `POST /operations/backup/create` — create a runtime backup (loopback + manager role required)
- `POST /operations/backup/restore` — restore from a runtime backup (loopback + manager role required)
- `GET /memory/lanes/:laneId/export` — export lane memory contents (loopback + manager role required)
- `POST /memory/lanes/:laneId/delete` — delete a lane's memory (loopback + manager role required)
- `POST /memory/lanes/:laneId/retention/run` — run retention for a specific lane (loopback + manager role required)

---

## Near-term roadmap

### Current focus
- **v2 control plane** — shipping as primary configuration path; `control-plane.json` replaces `family.json` for new setups
- **Lane memory** — lanes-only storage replaces scoped memory; lane topology driven by `memoryLanePolicies` in control plane
- **Onboarding v2** — `/onboard bootstrap` and `/onboard join` Telegram commands wire into the onboarding contract
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
| v2 Control Plane | ✅ Shipping | `control-plane.json` primary config; DecisionEnvelope pipeline |
| Lane-based memory | ✅ Shipping | Replaces scoped memory; lanes driven by control-plane profiles |
| family_group scope | ✅ Shipping | Mention-gated whole-family group chat |
| Per-member model selection | ✅ Shipping | modelPolicies in control plane |
| Onboarding v2 | ✅ Shipping | /onboard bootstrap/join Telegram commands + contract schema |
| Deterministic distillation | ✅ Working | Rule-based fact extraction |
| LLM distillation | ✅ Working | Optional mode in config |
| Session compaction | ✅ Working | Via OpenAI Responses API |
| Semantic search | ✅ Working | Local sqlite-vec + FTS hybrid retrieval |
| Transcript incremental indexing | ✅ Working | Watermark-based transcript chunk indexing |
| Background semantic sync | ✅ Working | Active-scope scheduler + `/status` snapshot |
| Admin server + Tauri status | ✅ Working | Includes semantic sync card + session controls |
| Tool framework | ✅ Working | Deny-by-default policy + web/lane/semantic/file-search tools |
| Hybrid file memory | ✅ Phase 3 shipped | Phase 1/2/3 shipped: retention dry-run/guardrails/manual trigger/status + scope allow/deny + policy presets + metadata-filtered manual runs |
| Backup/restore operations | ✅ Working | loopback + manager-role guarded |
| Lane memory admin operations | ✅ Working | Export, delete, retention per lane (loopback + manager role) |
| Evals harness | 🟡 Planned | Documented direction, limited automation today |
| Multi-model runtime | 🟡 Partial | Per-member model via modelPolicies; broader routing planned |
| Proactive notifications | ❌ Reactive only | No scheduled proactive messaging yet |
| Voice | ❌ Not implemented | Planned |

---

## Directory Structure

```
openai-agents/
├── src/
│   ├── gateway/          # Gateway runtime + admin endpoints
│   ├── interfaces/
│   │   ├── telegram/     # Telegram bot (grammY) + onboarding commands
│   │   └── cli/          # CLI runner
│   ├── memory/           # Lane memory, distillation, lane topology
│   ├── sessions/         # FileBackedSession, compaction
│   ├── runtime/          # Config loading (haloConfig, familyConfig, onboardingFlow)
│   ├── prime/            # Prime agent orchestration
│   ├── policies/         # DecisionEnvelope pipeline
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
| `config/control-plane.example.json` | v2 control plane config template (primary) |
| `config/halo.example.json` | Gateway + feature config (includes `controlPlane` loader block) |
| `config/family.example.json` | v1 legacy family member definitions |
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
