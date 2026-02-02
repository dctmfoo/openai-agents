# Scope (v1)

## What we’re building first

### Interfaces

- **CLI-first** (single command to run Prime)
- Telegram / dashboard / voice: later phases

### Core architecture

- **Prime agent**: one conversational entity that users interact with
- **Specialists**: initially implemented as **agents-as-tools** (manager pattern)
- **Tool policy layer**: wrappers enforcing allowlists + approvals
- **Tracing/logging**: write events to `logs/events.jsonl`

### Memory (v1)

File-based, simple and reliable:

- `memory/core/*.md` — identity/preferences that should persist
- `memory/daily/YYYY-MM-DD.md` — daily log / raw notes
- Retrieval: grep/ripgrep + simple heuristics

(Cold/semantic memory later.)

### Evals (v1)

- A small **regression suite** that must stay green
- Some checks are deterministic; some are model-graded (“LLM-as-judge”)
- Add pass^k for reliability (run same eval N times)

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
