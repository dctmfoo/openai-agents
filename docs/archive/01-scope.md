# Scope (v1)

## What we're building first

### Interfaces

- **Telegram-first** (family DMs + parents-only group)
- CLI available for local testing (`pnpm dev:cli "..."`)
- Dashboard / voice: later phases

### Core architecture

- **Prime agent**: one conversational entity that users interact with
- **Specialists**: planned (not implemented yet)
- **Tool policy layer**: planned; today we only enforce interface-level policy and keep tools minimal
- **Tracing/logging**: write events to `HALO_HOME/logs/events.jsonl`

### Memory (v1)

File-based, simple and reliable.

Scoped memory lives under `<rootDir>/memory/scopes/<hash>/`.
- `MEMORY.md` — durable facts (preferences, relationships)
- `YYYY-MM-DD.md` — temporal daily notes
- Telegram adapter appends lightweight `[user]` / `[prime]` lines to the daily file

`rootDir` is `HALO_HOME` for gateway, `dev:telegram`, and `dev:cli`.

CLI mode:
- Writes a daily log at `HALO_HOME/memory/YYYY-MM-DD.md` via `appendDailyNote` (non-scoped)
- Prime still reads scoped memory (plus `SOUL.md` + `USER.md`) for its context; the unscoped CLI log is not used for retrieval

CLI still uses the default SessionStore (HALO_HOME) unless you override it.

Retrieval:
- Prime loads `SOUL.md`, `USER.md`, scoped `MEMORY.md`, and scoped daily notes for today + yesterday
- There is no grep/search layer yet

(Cold/semantic memory later.)

### Evals (v1)

- Deterministic unit tests + a smoke test must stay green
- LLM-as-judge evals and pass^k reliability checks are planned, not implemented yet

## What we’re explicitly not doing in v1

- Full MCP ecosystem and connector zoo
- High-risk actions (payments, emails, irreversible changes) without approvals
- Autonomous background workers

## Milestones

- M0: Repo + docs (this phase)
- M1: Prime CLI runs, logs traces
- M2: Tool policy + 2–3 safe tools
- M3: File memory + retrieval
- M4: Evals gate PRs
