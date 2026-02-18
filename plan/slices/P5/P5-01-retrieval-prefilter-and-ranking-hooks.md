# P5-01 — Retrieval prefilter + ranking hooks

- Status: `DONE`

Task:
- Enforce prefilter by allowed lanes/scopes before retrieval.
- Add extension hooks for rerank/neighbor expansion without bypassing prefilter.

Verification:
```bash
pnpm test
pnpm build
pnpm check:deadcode
```

Completion evidence:
- Focused RED→GREEN loops:
  - `pnpm vitest run src/memory/searchEngine.test.ts` (RED then GREEN)
  - `pnpm vitest run src/tools/semanticSearch.test.ts src/memory/searchEngine.test.ts` (RED then GREEN)
- Slice gate:
  - `pnpm test` ✅
  - `pnpm build` ✅
  - `pnpm check:deadcode` ✅
