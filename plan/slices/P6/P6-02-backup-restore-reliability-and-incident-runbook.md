# P6-02 — Backup/restore + reliability + incident runbook

- Status: `DONE`

Task:
- Define and implement backup/restore strategy for local family deployment.
- Add failure-handling and incident response runbook hooks.

Verification:
```bash
pnpm test
pnpm build
pnpm check:deadcode
```

Completion evidence:
- Focused RED→GREEN loops:
  - `pnpm vitest run src/runtime/backupManager.test.ts` (RED missing module, then GREEN)
  - `pnpm vitest run src/runtime/incidentLog.test.ts` ✅
  - `pnpm vitest run src/gateway/admin.test.ts` (RED on backup endpoints returning 404, then GREEN)
  - `pnpm vitest run src/runtime/backupManager.test.ts src/runtime/incidentLog.test.ts src/gateway/admin.test.ts` ✅
- Reliability/runbook deliverables:
  - Backup/restore runtime manager implemented with manifest-backed snapshots.
  - Incident hooks write structured failures into `logs/incidents.jsonl`.
  - Operator runbook documented in `docs/19-backup-restore-and-incident-runbook.md`.
- Slice gate:
  - `pnpm test` ✅
  - `pnpm build` ✅
  - `pnpm check:deadcode` ✅ (hints only, no dead-code failures)
