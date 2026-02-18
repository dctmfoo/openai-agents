# S1-06 — Telegram integration + phase 1 gate

- Main spec reference: `plan/35-2026-02-17-v2-policy-control-plane-reset-plan.md` (sections 5, 6, 7)
- Blueprint reference: `docs/18-policy-control-plane-blueprint.md` (sections 4, 6, 12, 13)
- Status: `TODO`
- AssignedTo: `unassigned`
- StartedAt: `TBD`

## Problem statement

Even with new policy primitives, behavior is not complete until Telegram message handling is routed through the V2 envelope and lane/capability/safety gates.

## Task

1. Integrate decision envelope resolver into Telegram handling path.
2. Enforce mention gating for family-group behavior.
3. Ensure all tool/model/retrieval operations consume resolved envelope allowances only.
4. Emit structured policy rationale logs for observability.
5. Close phase with acceptance test pass against V1 top-80% scenarios.

## Allowed file changes (strict)

- `src/interfaces/telegram/**`
- `src/gateway/**` (only where envelope visibility/status is required)
- `src/prime/**` (only required wiring)
- related tests in touched modules
- `plan/slices/S1/S1-06-telegram-integration-and-phase-gate.md`

## Forbidden in this slice

- No unrelated UI redesign.
- No out-of-scope provider integrations.

## Deliverables

1. Telegram path uses decision envelope for all runs.
2. Family-group mention gating and safe output behavior wired.
3. Policy rationale visible in runtime/events logs.
4. Phase gate checklist marked complete.

## Verification (required)

Focused checks:

```bash
pnpm vitest run src/interfaces/telegram/policy.test.ts src/interfaces/telegram/bot.test.ts src/gateway/admin.test.ts
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
  - `S1-06: wire v2 decision envelope into telegram runtime and close phase 1`

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
