# P6-01 — Parent controls + retention/delete/export

- Status: `DONE`

Task:
- Implement parent-managed policy controls for operations.
- Add per-lane retention and delete/export management paths.

Verification:
```bash
pnpm test
pnpm build
pnpm check:deadcode
```

Completion evidence:
- Focused RED→GREEN loops:
  - `pnpm vitest run src/runtime/operationsPolicy.test.ts` (RED missing module, then GREEN)
  - `pnpm vitest run src/memory/laneOperations.test.ts` (RED missing module, then GREEN)
  - `pnpm vitest run src/runtime/familyConfig.test.ts` (RED on `operations` schema key, then GREEN)
  - `pnpm vitest run src/runtime/operationsAudit.test.ts` (RED missing module, then GREEN)
  - `pnpm vitest run src/gateway/admin.test.ts` (RED with new route 404s, then GREEN)
  - `pnpm vitest run src/runtime/operationsPolicy.test.ts src/memory/laneOperations.test.ts src/runtime/familyConfig.test.ts src/runtime/operationsAudit.test.ts src/gateway/admin.test.ts` ✅
- Slice gate:
  - `pnpm test` ✅
  - `pnpm build` ✅
  - `pnpm check:deadcode` ✅ (hints only, no dead-code failures)
