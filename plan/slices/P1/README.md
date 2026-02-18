# Pack 1 — Control-plane core

Primary references:
- `plan/36-2026-02-17-production-ready-pack-sequencing-plan.md`
- `docs/18-policy-control-plane-blueprint.md`

Functional outcome for Pack 1:
- deterministic policy envelope exists,
- control-plane schema/loader exists,
- baseline role/scope policy scenarios are executable and tested.

Execution order:
1. `P1-01-decision-envelope-contract-and-red-scenarios.md`
2. `P1-02-control-plane-schema-loader-and-fixtures.md`
3. `P1-03-policy-resolver-precedence-and-pack-gate.md`

Mandatory process:
- TDD red → green → refactor.
- one slice at a time.
- update slice completion evidence in the same commit.

Pack gate commands:
```bash
pnpm test
pnpm build
pnpm check:deadcode
```
