# Pack 4 — Memory lanes + distillation + indexing

Functional outcome:
- lane-safe memory write/read/daily-log behavior,
- distillation pipeline emits lane-safe outputs,
- transcript and lane indexes align with policy boundaries.

Execution order:
1. `P4-01-memory-lane-topology-and-metadata-contract.md`
2. `P4-02-distillation-flush-and-lane-routing.md`
3. `P4-03-lane-aware-context-load-and-pack-gate.md`

Pack gate commands:
```bash
pnpm test
pnpm build
pnpm check:deadcode
```
