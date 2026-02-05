# AGENTS.md — Contributor & Agent Guide

> **📌 Main Project Document: [docs/PROJECT-OVERVIEW.md](docs/PROJECT-OVERVIEW.md)**
> 
> For comprehensive project status, feature tracking, tech stack, and roadmap, see the Project Overview. This file (AGENTS.md) is for contributor/agent guidelines.

---

This repository is a **public, portfolio-quality reference implementation** of a personal companion built with the **OpenAI Agents SDK (TypeScript)**.

Primary interface: **Telegram (private chats only)**. Secondary: local **Gateway + Tauri v2 admin app**.

## Project goals

- Showcase **idiomatic OpenAI Agents SDK patterns** (Agent/Runner, tools, sessions, compaction, guardrails, tracing).
- Keep the code **elegant and teachable**: small modules, minimal abstractions, strong typing.
- Be "working software" (not fully production hardened), but a solid foundation others can extend.

## Non-goals (for now)

- A production-grade, multi-tenant hosted service.
- A huge integrations zoo.
- Fully autonomous long-running agents without explicit safety boundaries.

## Repo structure

- `src/prime/` — Prime (the main orchestrator agent).
- `src/gateway/` — Gateway runtime + admin endpoints.
- `src/interfaces/telegram/` — Telegram bot interface (Grammy).
- `src/interfaces/cli/` — CLI runner for local testing.
- `src/memory/` — markdown memory file loader/writer and distillation.
- `src/utils/` — logging utilities.
- `apps/admin/` — Tauri v2 admin app (Vite dev server).
- `docs/` — architecture notes, setup, **PROJECT-OVERVIEW.md**.
- `memory/` — repo-local daily memory logs (`YYYY-MM-DD.md`, CLI-only).
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
- Don't claim actions you didn't take.
- Never persist obvious secrets in memory files.

## Memory model (markdown files)

- Scoped memory lives under `HALO_HOME/memory/scopes/<hash>/MEMORY.md` and `HALO_HOME/memory/scopes/<hash>/YYYY-MM-DD.md`.
- `memory/YYYY-MM-DD.md` in the repo is a CLI-only daily log; Prime reads scoped memory for context.

Current:
- Agents SDK **Sessions** for conversation state.
- **OpenAIResponsesCompactionSession** (Responses API `/responses/compact`) when compaction is enabled.
- A deterministic memory distiller writes lasting vs temporal facts into scoped markdown files.

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

Commands:

- `pnpm test` — unit tests
- `pnpm evals` — behavioral evals (planned)

Quality bar:
- Prime behavior stays consistent.
- Memory writeback rules don't regress.
- Safety boundaries remain enforced.

## Work in progress

See [docs/PROJECT-OVERVIEW.md](docs/PROJECT-OVERVIEW.md) for current milestone and feature status.

## Docs MCP

Always use the OpenAI developer documentation MCP server if you need to work with the OpenAI API, Agents SDK, Codex, etc., without me having to explicitly ask.

- MCP name: `openaiDeveloperDocs`
- URL: https://developers.openai.com/mcp

## Dead Code / Unused Exports (knip)

This repo runs `knip` (via `pnpm check:deadcode`) in CI. Knip traces export reachability from the entry points defined in `knip.json`.

**Critical rule: Only `export` what is actually imported by another module.**

- If a type, function, or constant is only used within the same file → **do NOT export it**
- If it's only used within the same directory but not imported from outside → **do NOT export it**
- Knip will fail CI if any export is unreachable from the entry points
- This applies to types too: `type Foo = ...` not `export type Foo = ...` unless another file imports `Foo`

**Before adding `export`**, check: "Is another file going to `import { X } from` this module?" If no, keep it internal.

Common mistake: exporting helper types "just in case" — don't do this. Export only the public API surface.
