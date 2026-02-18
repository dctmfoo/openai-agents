# P6-03 — Family-ready acceptance gate

- Status: `DONE`

Task:
- Execute end-to-end family scenarios:
  - onboarding spouse + children,
  - DM/group behavior,
  - sensitive topic routing,
  - lane-safe retrieval,
  - voice-note path,
  - retention/delete operations.
- Close roadmap only when all gates pass with evidence.

Verification:
```bash
pnpm test
pnpm build
pnpm check:deadcode
pnpm check:complexity
```

Completion evidence:
- Family-ready acceptance suite:
  - Added `src/dev/familyReadyAcceptance.test.ts` with scenario coverage for onboarding, policy routing, retrieval prefiltering, voice fallback, and retention/delete flows.
- Focused RED→GREEN loops:
  - `pnpm vitest run src/dev/familyReadyAcceptance.test.ts` (initial RED syntax failure, then GREEN)
  - `pnpm vitest run src/dev/familyReadyAcceptance.test.ts src/gateway/admin.test.ts` ✅
- Slice gate:
  - `pnpm test` ✅
  - `pnpm build` ✅
  - `pnpm check:deadcode` ✅ (hints only, no dead-code failures)
  - `pnpm check:complexity` ✅ (warnings only, no errors)
