# S1-05 — RAG/file-search lane prefilter + citation guard

- Main spec reference: `plan/35-2026-02-17-v2-policy-control-plane-reset-plan.md` (sections 3, 5, 6)
- Blueprint reference: `docs/18-policy-control-plane-blueprint.md` (section 9)
- Status: `TODO`
- AssignedTo: `unassigned`
- StartedAt: `TBD`

## Problem statement

Retrieval currently relies on scope-level behavior and does not enforce lane prefiltering as a hard contract.

## Task

1. Add lane/scope metadata requirements for searchable memory/file records.
2. Enforce retrieval candidate prefiltering by allowed lanes/scopes before vector/text ranking.
3. Add citation/output guard to prevent references to disallowed lanes.
4. Add tests for leakage attempts across parent-private/child-private boundaries.

## Allowed file changes (strict)

- `src/memory/**`
- `src/files/**`
- `src/tools/semanticSearchTool.ts` and related tests
- `src/files/*.test.ts`, `src/memory/*.test.ts`, `src/tools/*.test.ts`
- `plan/slices/S1/S1-05-rag-file-search-lane-prefilter-and-citation-guard.md`

## Forbidden in this slice

- No Telegram integration rewiring yet.
- No admin UX extension yet.

## Deliverables

1. Retrieval prefilter gate implementation.
2. Metadata contract coverage in indexing/retrieval path.
3. Leakage-prevention tests for disallowed-lane retrieval/citation.

## Verification (required)

Focused checks:

```bash
pnpm vitest run src/tools/semanticSearch.test.ts src/files/fileMemoryLifecycle.test.ts src/files/openaiFileIndexer.test.ts
```

Then full gates:

```bash
pnpm test
pnpm build
pnpm check:deadcode
pnpm check:complexity
```

## Commit + handoff

- Commit subject example:
  - `S1-05: enforce lane-scoped retrieval prefiltering for rag and file search`

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
  - `pnpm check:complexity`
