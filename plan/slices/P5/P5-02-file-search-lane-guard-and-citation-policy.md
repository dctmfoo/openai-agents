# P5-02 — File-search lane guard + citation policy

- Status: `DONE`

Task:
- Ensure file index metadata carries lane/scope policy tags.
- Block disallowed-lane citations in final outputs.

Verification:
```bash
pnpm test
pnpm build
pnpm check:deadcode
```

Completion evidence:
- Focused RED→GREEN loops:
  - `pnpm vitest run src/files/scopeFileRegistry.test.ts src/files/citationPolicy.test.ts` (RED then GREEN)
  - `pnpm vitest run src/interfaces/telegram/bot.test.ts src/interfaces/telegram/policy.test.ts src/files/scopeFileRegistry.test.ts src/files/citationPolicy.test.ts` ✅
- Slice gate:
  - `pnpm test` ✅
  - `pnpm build` ✅
  - `pnpm check:deadcode` ✅
