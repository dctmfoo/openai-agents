# S1-04 — Memory lane read/write enforcement

- Main spec reference: `plan/35-2026-02-17-v2-policy-control-plane-reset-plan.md` (sections 3, 5, 6)
- Blueprint reference: `docs/18-policy-control-plane-blueprint.md` (sections 8, 11)
- Status: `TODO`
- AssignedTo: `unassigned`
- StartedAt: `TBD`

## Problem statement

Scoped memory is currently keyed by scope hash, but lane-level read/write enforcement is not first-class.

## Task

1. Introduce lane-aware memory write routing.
2. Enforce lane-aware read filtering for context loading.
3. Add tests proving parent-private and child-private isolation.
4. Ensure family-group responses cannot read disallowed private lanes.

## Allowed file changes (strict)

- `src/memory/**`
- `src/tools/scopedMemoryTools.ts` and related tests if needed
- `src/memory/*.test.ts`
- `plan/slices/S1/S1-04-memory-lane-write-read-enforcement.md`

## Forbidden in this slice

- No RAG/vector retrieval prefilter integration yet.
- No Telegram command/handler rewiring yet.

## Deliverables

1. Lane-aware memory IO primitives.
2. Isolation tests for parent/private and child/private lanes.
3. Backward-safe migration notes (if path changes are required).

## Verification (required)

Focused checks:

```bash
pnpm vitest run src/memory/memoryBoundaries.test.ts src/memory/scopedMemory.test.ts src/tools/scopedMemoryTools.test.ts
```

Then full gates:

```bash
pnpm test
pnpm build
pnpm check:deadcode
```

## Commit + handoff

- Commit subject example:
  - `S1-04: enforce memory lane read/write boundaries`

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
