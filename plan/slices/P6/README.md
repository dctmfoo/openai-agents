# Pack 6 — Operations, retention, reliability, family-ready release gate

Functional outcome:
- parent can operate and govern system safely,
- per-lane retention and deletes are enforced,
- reliability/runbook standards are in place,
- family-ready acceptance suite is green.

Execution order:
1. `P6-01-parent-controls-retention-delete-export.md`
2. `P6-02-backup-restore-reliability-and-incident-runbook.md`
3. `P6-03-family-ready-acceptance-gate.md`

Pack gate commands:
```bash
pnpm test
pnpm build
pnpm check:deadcode
pnpm check:complexity
```
