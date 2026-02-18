# Planning index

Active production roadmap:
- `plan/36-2026-02-17-production-ready-pack-sequencing-plan.md` (**active**)

Archived drafts/specs:
- `plan/archive/34-2026-02-16-parent-controlled-model-capabilities-and-multi-scope-memory-plan.md`
- `plan/archive/35-2026-02-17-v2-policy-control-plane-reset-plan.md`
- `plan/archive/slices/S1-v0/`

Execution packs:
- `plan/slices/P1/` — control-plane core
- `plan/slices/P2/` — family onboarding + identity lifecycle
- `plan/slices/P3/` — conversation surfaces + group policy
- `plan/slices/P4/` — memory lanes + distillation + indexing
- `plan/slices/P5/` — retrieval/file-search/voice-note pipeline
- `plan/slices/P6/` — operations, retention, reliability, family-ready gate

## How contributors/agents execute packs

1. Read the active roadmap (`36-...plan.md`) first.
2. Start with the next unfinished pack and then the next unfinished slice in that pack.
3. Mark slice `Status: IN_PROGRESS` with `AssignedTo` + `StartedAt`.
4. Implement only the slice scope.
5. Run focused checks + full gates listed in the slice.
6. Mark slice `Status: DONE` with completion evidence in the same commit.

## Mandatory quality gates

Every slice must follow `AGENTS.md`:
- TDD red → green → refactor
- verification discipline
- OpenAI-doc loop for OpenAI behavior claims

Full handoff gates (unless slice demands stricter gates):

```bash
pnpm test
pnpm build
pnpm check:deadcode
```
