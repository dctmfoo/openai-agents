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

## Dead code checks (Knip)

We track unused exports/files/deps with Knip.

- Run `pnpm check:deadcode` to get a report.
- Config lives in `knip.json` (entry points + project globs).
- Suppressions:
  - Use JSDoc `@public` for exports that are intentionally public.
- Use JSDoc `@lintignore` (no hyphen) for one-off false positives. The config excludes this tag.

## Duplicate code checks (jscpd)

We track copy/paste duplication with jscpd.

- Run `pnpm check:dup` to scan for duplicates.
- Config lives in `jscpd.json` (thresholds + exclusions).

## Complexity checks (ESLint + SonarJS)

We track cyclomatic complexity (plus a cognitive-complexity sanity check) with ESLint.

- Run `pnpm check:complexity` to see warnings.
- Thresholds are warnings (no hard failures) so you can address incrementally.
- Current thresholds are 15 for both cyclomatic and cognitive complexity.
- If a warning fires, reduce complexity by extracting helpers, splitting long functions, or simplifying nested conditionals.

## Pre-commit hooks

Enable fast checks locally:

- Run `scripts/dev/install-hooks.sh` from the repo root.

The hook runs `pnpm test` and `pnpm build` before each commit.

Opt-out for a single commit:

- `SKIP_PRECOMMIT=1 git commit -m "message"`
