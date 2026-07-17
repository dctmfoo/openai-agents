# S1-03 — Policy resolver (capabilities + model plan + safety plan)

- Main spec reference: `plan/35-2026-02-17-v2-policy-control-plane-reset-plan.md` (sections 2, 5, 6)
- Blueprint reference: `docs/18-policy-control-plane-blueprint.md` (sections 4, 6, 7, 11)
- Status: `TODO`
- AssignedTo: `unassigned`
- StartedAt: `TBD`

## Problem statement

The runtime currently resolves policy with fragmented role/scope logic and no unified decision envelope.

## Task

1. Implement resolver that outputs deterministic envelope:
   - action (`allow`/`deny`/`requires_parent_approval`)
   - allowed capabilities
   - model plan
   - safety plan
   - rationale
2. Encode low/medium/high sensitive-topic handling policy.
3. Add unit tests for policy precedence and conflict resolution.

## Allowed file changes (strict)

- `src/policies/**`
- `src/prime/types.ts` (if shared types required)
- `src/policies/*.test.ts`
- `plan/slices/S1/S1-03-policy-resolver-capability-model-safety.md`

## Forbidden in this slice

- No memory lane write/read enforcement changes yet.
- No retrieval prefilter integration yet.
- No Telegram handler rewiring yet.

## Deliverables

1. Envelope resolver implementation.
2. Tests for role/scope/profile/safety precedence.
3. Stable public resolver API for later slices.

## Verification (required)

Focused checks:

```bash
pnpm vitest run src/policies/toolPolicy.test.ts src/policies/contentFilter.test.ts
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
  - `S1-03: implement v2 policy resolver with capability/model/safety plans`

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
