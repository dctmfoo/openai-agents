# P1-01 — Decision envelope contract + red scenarios

- Status: `DONE`
- AssignedTo: `pi-tmux-delegate`
- StartedAt: `2026-02-17T22:31:00+05:30`

## Task

1. Define policy decision envelope types (speaker/scope/intent/action/capabilities/lanes/model/safety/rationale).
2. Add failing tests for baseline scenarios:
   - parent DM allow,
   - child DM allow,
   - family-group no-mention deny,
   - unknown user deny.
3. Keep implementation minimal in this slice; focus on contract + test shape.

## Allowed file changes

- `src/policies/**` (new files allowed)
- `src/interfaces/telegram/policy.test.ts` (or new dedicated policy-envelope tests)
- `plan/slices/P1/P1-01-decision-envelope-contract-and-red-scenarios.md`

## Verification

```bash
pnpm vitest run src/interfaces/telegram/policy.test.ts
pnpm test
pnpm build
pnpm check:deadcode
```

## Mark complete

- [x] Status set to `DONE`
- CompletedBy: `pi`
- CompletedAt: `2026-02-17T22:33:30+05:30`
- CommitOrPR: `N/A (local workspace changes only)`
- VerificationEvidence:
  - `pnpm vitest run src/interfaces/telegram/policy.test.ts` ✅ (10 passed)
  - `pnpm test` ✅ (259 passed)
  - `pnpm build` ✅
  - `pnpm check:deadcode` ✅ (passes; only existing configuration hints)
