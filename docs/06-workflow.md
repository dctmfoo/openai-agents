# Workflow (Task board + agent squad)

This repo is public and portfolio-quality. We run it like a small engineering team.

## Source of truth

- Work is tracked in **GitHub Issues**.
- The board is **GitHub Projects** (Kanban).
- PRs should reference issues and close them when merged.

## Labels

We use a small, consistent label set:

- Types: `type:feature`, `type:bug`, `type:design`
- Areas: `area:telegram`, `area:sessions`, `area:compaction`, `area:memory`, `area:nodes`, `area:security`, `area:docs`, `area:tests`
- Priority: `priority:p0`, `priority:p1`, `priority:p2`

## Definition of Done (DoD)

A task is done when:

- Code changes are covered by **deterministic tests** (`pnpm test`) where feasible.
- Docs updated if behavior/architecture changed.
- Safety boundaries preserved (deny-by-default; no cross-member leaks).

## Agent squad (recommended)

We use multiple “roles” (can be humans or different models), but outputs must land in issues/docs/PRs.

- **Architect (high reasoning)**: drafts design docs, threat model notes, tradeoffs.
- **Implementer (high)**: writes code in small PRs with tests.
- **Verifier/QA (high)**: tries to break it; writes regression tests.
- **Reviewer (Opus-level)**: critiques design & PRs; catches missing edge cases.

## TDD

Default: red → green → refactor.

If something is hard to test end-to-end (Telegram), isolate pure logic and test that.
