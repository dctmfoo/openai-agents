# Roadmap

This repo evolves in small, reviewable PRs. The canonical history is the PR list; this doc is a lightweight index.

## Current milestone

### M5: Memory distillation (scoped, no leakage)

Issue: https://github.com/dctmfoo/openai-agents/issues/29

**Goal**
- Distill conversation transcripts into per-scope memory (DM vs parents-group) without leakage.

**Exit criteria**
- Distiller writes lasting facts to: `HALO_HOME/memory/scopes/<hash>/MEMORY.md`
- Temporals stay in: `HALO_HOME/memory/scopes/<hash>/YYYY-MM-DD.md`
- Tests prove DM scope never reads/writes parents-group scope (and vice versa)
- Deterministic distillation path (no network), with optional LLM mode behind a flag

**Already shipped**
- PR #28: scoped memory foundation (Prime + Telegram now write/read scoped daily memory)

## Next

### M6: Distillation triggers + failure handling
- When do we distill? (on compaction vs every N messages)
- What happens on distillation failure? (log + continue)

### M7: Boundary-first tool policy
- Tools remain deny-by-default
- Add safe read-only tools with explicit scope constraints

## Later

- Better onboarding (unknown DM flow)
- Richer Prime behavior + sub-agents-as-tools
- Evals harness for behavior regressions

## Backlog (proposed)

These are not committed milestones yet; they’re proposed follow-ups that naturally fall out of “LLM distillation + Admin tooling”. We track these in the GitHub Project and promote them into milestones when we’re ready.

GitHub Project (canonical queue): https://github.com/users/dctmfoo/projects/2

- **Audit + observability**: append-only distillation journal under `HALO_HOME/memory/distillation/` (JSONL) with timestamps, scopeId hash, transcript window, model, usage, and errors.
- **Cost + safety guardrails**: cap input size / transcript items / runs-per-day per scope; fail closed with clear logs.
- **Incremental distillation (cursored)**: distill only “new since last cursor” instead of reprocessing full history.
- **Batch distill (safe queue)**: “distill all parents scopes” with concurrency=1, progress, and cancel.
- **Failure backoff/retry policy**: exponential backoff per scope to avoid rapid retry loops.
- **Docs + project hygiene**: keep docs + GitHub Project in sync on a regular cadence (see ops cron).
