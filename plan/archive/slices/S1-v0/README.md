# Phase 1 Slice Set — V2 control-plane foundation

Main references:
- `plan/35-2026-02-17-v2-policy-control-plane-reset-plan.md` (primary)
- `docs/18-policy-control-plane-blueprint.md` (functional/policy source of truth)
- `docs/17-family-architecture-discussion-in-progress.md` (discussion context)
- `plan/README.md`

Status:
- `S1` is the active phase.
- Delivery mode: ordered vertical slices (one slice at a time, one commit at a time).

Execution order:
1. `S1-01-decision-envelope-contract-and-red-scenarios.md`
2. `S1-02-control-plane-schema-and-loader.md`
3. `S1-03-policy-resolver-capability-model-safety.md`
4. `S1-04-memory-lane-write-read-enforcement.md`
5. `S1-05-rag-file-search-lane-prefilter-and-citation-guard.md`
6. `S1-06-telegram-integration-and-phase-gate.md`

## Mandatory process rules

- Follow `AGENTS.md` mandatory workflow (TDD red → green → refactor).
- No out-of-scope changes within a slice.
- Update slice status/evidence in the same commit as implementation.
- Keep each slice small and reviewable.

## Verification block standard (required in each slice)

1. Focused tests for touched modules.
2. Wiring/integration checks when policy routing changes.
3. Full handoff gates:
   - `pnpm test`
   - `pnpm build`
   - `pnpm check:deadcode`

## Commit discipline

- Commit subject should include slice id (example: `S1-02: add control-plane schema and loader`).
- Minimum one commit per completed slice.
