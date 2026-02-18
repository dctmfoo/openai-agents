# S1-01 — Decision envelope contract + red scenario tests

- Main spec reference: `plan/35-2026-02-17-v2-policy-control-plane-reset-plan.md` (sections 2, 3, 5, 6)
- Blueprint reference: `docs/18-policy-control-plane-blueprint.md` (section 4)
- Status: `TODO`
- AssignedTo: `unassigned`
- StartedAt: `TBD`

## Problem statement

Current runtime does not enforce a single deterministic decision envelope before tools/models execute.

## Task

1. Define TS contract(s) for V2 decision envelope (policy version, speaker/scope/intent, action, lanes, capabilities, model plan, safety plan, rationale).
2. Add failing tests for canonical scenarios (no implementation yet):
   - parent DM allow
   - child DM allow
   - family group no-mention deny
   - family group mention allow with restricted visibility
   - unknown user deny
3. Wire a placeholder resolver entrypoint that returns `NotImplemented` or equivalent (still red tests expected first).

## Allowed file changes (strict)

- `src/policies/**` (new files allowed)
- `src/interfaces/telegram/policy.test.ts` (or new dedicated policy envelope tests)
- `src/prime/types.ts` (only if needed for shared envelope typing)
- `plan/slices/S1/S1-01-decision-envelope-contract-and-red-scenarios.md`

## Forbidden in this slice

- No telegram adapter integration changes.
- No memory retrieval gating yet.
- No model-selection runtime behavior changes yet.

## Deliverables

1. Decision envelope type contract committed.
2. Red scenario tests committed (failing first, then minimal green if split commits inside slice are needed).
3. Clear TODO markers for remaining slices.

## Verification (required)

Run focused tests:

```bash
pnpm vitest run src/interfaces/telegram/policy.test.ts
```

Then full gates:

```bash
pnpm test
pnpm build
pnpm check:deadcode
```

## Commit + handoff

- Commit subject example:
  - `S1-01: add decision envelope contract and baseline policy scenarios`

## Mark complete here

- [ ] Set `Status` to `DONE`
- CompletedBy: `TBD`
- CompletedAt: `TBD`
- CommitOrPR: `TBD`
- VerificationEvidence:
  - `pnpm vitest run ...`
  - `pnpm test`
  - `pnpm build`
  - `pnpm check:deadcode`
