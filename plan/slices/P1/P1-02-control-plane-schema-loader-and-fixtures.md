# P1-02 — Control-plane schema, loader, and fixtures

- Status: `DONE`
- AssignedTo: `pi-tmux-delegate`
- StartedAt: `2026-02-17T22:36:00+05:30`

## Task

1. Add V2 control-plane schema and loader (config-driven, extensible; no hardcoded family-specific or age-threshold behavior).
2. Add baseline fixtures/examples for local family deployment.
3. Add validation tests (valid, invalid, missing-file).

## Allowed file changes

- `src/runtime/**`
- `config/**`
- `src/runtime/*.test.ts`
- `plan/slices/P1/P1-02-control-plane-schema-loader-and-fixtures.md`

## Verification

```bash
pnpm vitest run src/runtime/familyConfig.test.ts src/runtime/haloConfig.test.ts
pnpm test
pnpm build
pnpm check:deadcode
```

## Mark complete

- [x] Status set to `DONE`
- CompletedBy: `pi`
- CompletedAt: `2026-02-17T22:42:23+05:30`
- CommitOrPR: `N/A (local workspace changes only)`
- VerificationEvidence:
  - `pnpm vitest run src/runtime/familyConfig.test.ts src/runtime/haloConfig.test.ts` ✅ (14 passed)
  - `pnpm test` ✅ (264 passed)
  - `pnpm build` ✅
  - `pnpm check:deadcode` ✅ (passes; only existing configuration hints)
