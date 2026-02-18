# 07 — Compounding Loop (Ralph-style)

This repo is a **public, portfolio-quality reference implementation**.

Some of the most effective ways to build with agents involve **local automation artifacts** (PRDs, task JSON, progress logs) that should **not** be committed to the public repo.

This doc describes the development loop we use, inspired by the **Ralph** pattern (autonomous loop with fresh context each iteration), plus a nightly “review → ship” schedule.

## Why we do this

Most developers use agents reactively: prompt → response → done.

The compounding loop turns that into:

1) **Learn**: extract patterns/gotchas from today’s work and update project instructions.
2) **Ship**: pick the next highest priority item and implement it with guardrails.

The key is that the agent **reads the updated instructions before building**, so mistakes get fixed once and avoided later.

## The two-part nightly loop (optional)

If/when we automate it:

- **Part A — Review / Distill** (e.g. 22:30)
  - Review the day’s work (threads, issues, PRs).
  - Extract learnings and update durable instructions (see below).
  - Commit only *repo-safe* instruction updates.

- **Part B — Execute / Ship** (e.g. 23:00)
  - Pull latest `main` (including the updated instructions).
  - Select the top priority item from the backlog.
  - Implement it with strict feedback loops (typecheck/tests).
  - Open a PR.

We’ll likely implement scheduling later (cron/launchd), but this doc defines the process now.

## Ralph-style execution loop (the core idea)

Ralph’s key ideas map cleanly to our project:

### 1) Each iteration = fresh context
Each loop iteration should start a **fresh agent instance** with clean context.

Memory between iterations should be only:

- **Git history** (commits)
- **A machine-readable task plan** (e.g. `prd.json`)
- **An append-only progress log** (e.g. `progress.txt`)

This prevents the agent from accumulating a huge prompt and slowly degrading.

### 2) Tasks must be right-sized
Each task should fit comfortably inside a single context window.

If a task can’t be finished in one iteration, it must be split.

### 3) Feedback loops are non-negotiable
Autonomy only works if errors are caught immediately.

Minimum required feedback loops:

- `pnpm typecheck`
- `pnpm test`
- (later) CI checks

If checks fail, the loop should fix them before moving on.

### 4) Instruction updates are part of the loop
Ralph explicitly updates instruction files each iteration.

For us, that means:

- **Public repo-safe** guidance goes in `AGENTS.md` and `docs/*`.
- **Private/local operational notes** (keys, personal memory, transcripts) must never be committed.

### 5) Stop conditions
The loop must have a hard stop condition:

- “All planned tasks are complete” OR “max iterations reached”.

## Proposed local artifacts (gitignored)

These are useful for the compounding loop but should stay local:

- `tasks/` — PRDs and scratch planning
- `prd.json` — machine-readable story list (with `passes: true/false`)
- `progress.txt` — append-only learnings across iterations
- `reports/` — generated prioritization reports
- `archive/` — archived runs
- `logs/compound-*.log` — automation logs

We keep **examples** committed (templates) so contributors understand the format:

- `tasks/prd.example.md`
- `prd.json.example`
- `reports/example.md`

## References

- Ryan Carson’s writeup (extracted locally): “How to make your agent learn and ship while you sleep”
- Ralph pattern repos:
  - https://github.com/snarktank/ralph
  - (background) https://ghuntley.com/ralph/
