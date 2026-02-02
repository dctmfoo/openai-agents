# AGENTS.md — Contributor & Agent Guide

This repository is a **public, portfolio-quality reference implementation** of a doot-style personal companion built with the **OpenAI Agents SDK (TypeScript)**.

Primary interface: **Telegram (private chats only)**.

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
- `src/interfaces/telegram/` — Telegram bot interface (Grammy).
- `src/interfaces/cli/` — CLI runner for local testing.
- `src/memory/` — OpenClaw-style memory file loader/writer and (soon) distillation.
- `src/utils/` — logging utilities.
- `docs/` — architecture notes, setup.
- `memory/` — daily memory logs (`YYYY-MM-DD.md`).
- `SOUL.md`, `USER.md`, `MEMORY.md` — OpenClaw-style context files loaded into Prime.
- `logs/` — runtime logs (`events.jsonl`, gitignored).

## Development commands

From repo root:

- `pnpm install`
- `pnpm dev:telegram` — run the Telegram bot locally.
- `pnpm dev:cli "…"` — run Prime from CLI.
- `pnpm build` — TypeScript build.

## Environment

Copy `.env.example` → `.env` and set:

- `OPENAI_API_KEY`
- `TELEGRAM_BOT_TOKEN`

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

## Memory model (OpenClaw-style)

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

## Testing / evals (upcoming)

We will add a small regression suite to ensure:
- Prime behavior stays consistent.
- Memory writeback rules don’t regress.
- Safety boundaries remain enforced.
