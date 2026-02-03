# AGENTS.md — Contributor & Agent Guide

This repository is a **public, portfolio-quality reference implementation** of a personal companion built with the **OpenAI Agents SDK (TypeScript)**.

Primary interface: **Telegram (private chats only)**. Secondary: local **Gateway + Tauri v2 admin app**.

## Project goals

- Showcase **idiomatic OpenAI Agents SDK patterns** (Agent/Runner, tools, sessions, compaction, guardrails, tracing).
- Keep the code **elegant and teachable**: small modules, minimal abstractions, strong typing.
- Be “working software” (not fully production hardened), but a solid foundation others can extend.

## Non-goals (for now)

- A production-grade, multi-tenant hosted service.
- A huge integrations zoo.
- Fully autonomous long-running agents without explicit safety boundaries.

## Repo structure

- `src/prime/` — Prime (the main orchestrator agent).
- `src/gateway/` — Gateway runtime + admin endpoints.
- `src/interfaces/telegram/` — Telegram bot interface (Grammy).
- `src/interfaces/cli/` — CLI runner for local testing.
- `src/memory/` — markdown memory file loader/writer and (soon) distillation.
- `src/utils/` — logging utilities.
- `apps/admin/` — Tauri v2 admin app (Vite dev server).
- `docs/` — architecture notes, setup.
- `memory/` — daily memory logs (`YYYY-MM-DD.md`).
- `SOUL.md`, `USER.md`, `MEMORY.md` — context files loaded into Prime.
- `logs/` — runtime logs (`events.jsonl`, gitignored).

## Development commands

From repo root:

- `pnpm install`
- `pnpm dev:telegram` — run the Telegram bot locally.
- `pnpm dev:cli "…"` — run Prime from CLI.
- `pnpm build` — TypeScript build.
- `pnpm start:gateway` — run the Gateway runtime (after build).
- `cd apps/admin && pnpm tauri:dev` — run the Tauri v2 admin app.

## Environment

Copy `.env.example` → `.env` and set:

- `OPENAI_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `HALO_HOME` (optional) — durable runtime state root; defaults to `~/.halo`.

## Style & engineering rules

- Prefer **OpenAI Agents SDK primitives** over custom frameworks.
- Keep Prime thin; push complexity into:
  - tools
  - sessions/compaction
  - memory distillation
  - evals
- Avoid cleverness. Optimize for clarity.
- Don’t claim actions you didn’t take.
- Never persist obvious secrets in memory files.

## Memory model (markdown files)

- `MEMORY.md`: curated, lasting facts.
- `memory/YYYY-MM-DD.md`: temporal facts / daily log.

Roadmap:
- Use Agents SDK **Sessions** for conversation state.
- Use **OpenAIResponsesCompactionSession** (Responses API `/responses/compact`) to keep sessions small.
- After compaction, run a memory distiller to write lasting vs temporal facts into markdown files.

## Contribution workflow

- Keep changes small and reviewable.
- If you add a feature, add a minimal doc note in `docs/`.
- Prefer Conventional Commits:
  - `feat: …`, `fix: …`, `docs: …`, `chore: …`

## Ralph runner (Codex loop)

- `scripts/ralph/ralph.sh` expects `prd.json` with `branchName` and `userStories` (array of story objects with `id` + `passes`).

## Test-Driven Development (TDD)

This repo follows **TDD** wherever feasible:

- Write a failing test first (red)
- Implement the minimal change to pass (green)
- Refactor for clarity (clean)

If a change is hard to test (e.g., depends on Telegram network), isolate logic into pure functions/modules and test those.

## Testing / evals

We keep two layers of tests:

1) **Deterministic tests** (fast, required)
- file/memory merge & dedupe logic
- session persistence adapters
- tool policy decisions (allow/deny)

2) **Behavioral evals** (slower, targeted)
- LLM-as-judge checks for tone/consistency
- regression prompts for memory distillation

Planned commands (we will wire these soon):

- `pnpm test` — unit tests
- `pnpm evals` — behavioral evals

Quality bar:
- Prime behavior stays consistent.
- Memory writeback rules don’t regress.
- Safety boundaries remain enforced.

## Work in progress

- Family-first policy + transcript admin tooling (iterating).
