# S1-02 — Control-plane schema and loader

- Main spec reference: `plan/35-2026-02-17-v2-policy-control-plane-reset-plan.md` (sections 5, 6)
- Blueprint reference: `docs/18-policy-control-plane-blueprint.md` (sections 5, 10, 11)
- Status: `TODO`
- AssignedTo: `unassigned`
- StartedAt: `TBD`

## Problem statement

Current config split (`config.json` + `family.json`) does not encode full V2 control-plane policy contracts.

## Task

1. Define V2 control-plane schema (members/profiles/scopes/lanes/capability tiers/model policy/safety escalation policy).
2. Add loader + validation path (fail-fast with clear errors).
3. Add fixtures/examples for local development.
4. Add tests for valid config, invalid config, and missing-file behavior.

## Allowed file changes (strict)

- `src/runtime/**` (new control-plane schema/loader modules)
- `config/**` (example config additions)
- `src/runtime/*.test.ts` (new tests)
- `plan/slices/S1/S1-02-control-plane-schema-and-loader.md`

## Forbidden in this slice

- No Telegram runtime integration yet.
- No policy resolver behavior integration yet.
- No memory lane enforcement changes yet.

## Deliverables

1. Control-plane schema + loader modules.
2. Example control-plane config.
3. Passing schema/loader tests.

## Verification (required)

Focused checks:

```bash
pnpm vitest run src/runtime/familyConfig.test.ts src/runtime/haloConfig.test.ts
```

Then full gates:

```bash
pnpm test
pnpm build
pnpm check:deadcode
```

## Commit + handoff

- Commit subject example:
  - `S1-02: add v2 control-plane schema and loader`

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
