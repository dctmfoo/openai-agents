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

## Communication preference (required)

When explaining work to Wags (or other non-implementation stakeholders), be **functional-first**:

1. **Direct answer first** (yes/no or recommendation in the first line).
2. **Functional impact** (what changes in behavior for users/operators).
3. **Why it matters** (risk reduced, failure mode avoided, or outcome improved).
4. **Implementation details last** (files/code only after the functional summary).

Style rules:
- Avoid leading with file names, code paths, or internal jargon.
- Prefer plain language and concrete behavior.
- If tradeoffs exist, present options briefly and clearly mark the recommendation.

## Style & engineering rules

- Prefer **OpenAI Agents SDK primitives** over custom frameworks.
- Keep Prime thin; push complexity into:
  - tools
  - sessions/compaction
  - memory distillation
  - evals
- Avoid cleverness. Optimize for clarity and teachability.
- Don’t claim actions you didn’t take.
- Never persist obvious secrets in memory files.

## Simplicity constraints (required)

- **No nested ternaries** — use `if/else` or `switch` for multi-branch logic.
- **No dense one-liners** — break compound operations into named steps.
- **Early returns over deep nesting** — guard clauses first, happy path flat below.
- **One responsibility per function** — split functions that do multiple jobs.
- **Flatten async flows** — prefer `async/await` over nested `.then()` chains.
- **No dead code** — remove unused imports, commented blocks, and unreachable branches.
- **Comments explain why, not what** — if a comment explains what, simplify the code.

## Memory model (markdown files)

- Scoped memory lives under `HALO_HOME/memory/scopes/<hash>/MEMORY.md` and `HALO_HOME/memory/scopes/<hash>/YYYY-MM-DD.md`.
- `memory/YYYY-MM-DD.md` in the repo is a CLI-only daily log; Prime reads scoped memory for context.

Current:
- Agents SDK **Sessions** for conversation state.
- **OpenAIResponsesCompactionSession** (Responses API `/responses/compact`) when compaction is enabled.
- A deterministic memory distiller writes lasting vs temporal facts into scoped markdown files.

## Mandatory contributor workflow

### 1) Small, reviewable slices (required)

- Keep changes small and reviewable.
- If behavior changes, add/update docs in `docs/` in the same PR.
- Prefer Conventional Commits:
  - `feat: …`, `fix: …`, `docs: …`, `chore: …`

### 2) TDD first (required)

Follow **red → green → refactor** in vertical slices:

1. Define one behavior change through a public interface.
2. **RED:** write one failing test for that behavior.
3. **GREEN:** implement the minimal change to pass that test.
4. Repeat one test / one implementation step at a time.
5. **REFACTOR:** clean structure only after tests are green.

Rules:
- No horizontal slicing (don’t write many tests upfront then bulk implement).
- Test behavior, not implementation internals.
- Mock only true boundaries (external APIs, filesystem, time/randomness, etc.).
- If a flow is hard to test (e.g., Telegram network), isolate pure logic and test that module.

### 3) Verification discipline (required)

Use fast loops while developing, then run full gates before handoff/merge.

- During development: run focused tests for touched modules.
- Before handoff/merge, always run:
  - `pnpm test`
  - `pnpm build`
  - `pnpm check:deadcode`
- For policy/tooling refactors, also run:
  - `pnpm check:complexity`

Quality bar:
- Prime behavior stays consistent.
- Memory writeback rules don’t regress.
- Safety boundaries remain enforced.

## Ralph runner (Codex loop)

- `scripts/ralph/ralph.sh` expects `prd.json` with `branchName` and `userStories` (array of story objects with `id` + `passes`).

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
