# Planning index

Primary architecture specs:
- `plan/34-2026-02-16-parent-controlled-model-capabilities-and-multi-scope-memory-plan.md` (active)

Execution slices:
- `plan/slices/S13/` (active)

## How contributors/agents should use this plan

1. Read the primary spec (`34-...plan.md`) first.
2. Pick the next unclaimed slice in `plan/slices/S13/`.
3. Set slice `Status` to `IN_PROGRESS`, fill `AssignedTo` + `StartedAt`.
4. Implement only the slice scope (no opportunistic refactors).
5. Run slice verification commands exactly as listed.
6. Update slice status/evidence in the same commit:
   - `Status: DONE`
   - `CompletedBy`, `CompletedAt`, `CommitOrPR`, `VerificationEvidence`.

## Mandatory quality gates

Every slice must follow `AGENTS.md`:
- TDD red → green → refactor
- verification discipline
- OpenAI Docs MCP authoritative docs loop

Full handoff gates (unless slice explicitly states stricter gates):

```bash
pnpm test
pnpm build
pnpm check:deadcode
```
