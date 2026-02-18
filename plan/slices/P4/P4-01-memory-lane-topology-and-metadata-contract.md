# P4-01 — Memory lane topology + metadata contract

- Status: `DONE`
- AssignedTo: `pi`
- StartedAt: `2026-02-18T01:00:48+05:30`
- CompletedBy: `pi`
- CompletedAt: `2026-02-18T01:08:02+05:30`

Task:
- Define lane IDs and storage metadata for docs/transcripts/chunks.
- Define private/shared lane defaults per configurable profile templates (e.g., parent, young_child, adolescent).

Verification:
```bash
pnpm test
pnpm build
pnpm check:deadcode
```

ScenarioEvidence:
- Added a centralized lane-topology contract that resolves member read/write lanes from:
  - control-plane profile -> memory-lane-policy mappings when present,
  - profile-template defaults otherwise (`parent_default`, `young_child`, `adolescent`, `child_default`).
- Lane-policy templates support member interpolation (`{memberId}` / `:self`) so profile rules stay reusable and config-driven.
- Added storage-metadata contract for artifacts (`document`, `transcript`, `chunk`) with deterministic visibility classification (`private`/`shared`/`system`).
- Control-plane normalization now preserves profile mappings in loaded family config so lane resolution can stay profile-driven at runtime.

VerificationEvidence:
- Focused TDD loops:
  - `pnpm vitest run src/memory/laneTopology.test.ts` ✅
  - `pnpm vitest run src/policies/decisionEnvelope.test.ts` ✅
  - `pnpm vitest run src/runtime/familyConfig.test.ts` ✅
  - `pnpm vitest run src/memory/laneTopology.test.ts src/policies/decisionEnvelope.test.ts src/memory/transcriptChunker.test.ts src/memory/transcriptSyncManager.test.ts src/files/scopeFileRegistry.test.ts src/files/openaiFileIndexer.test.ts` ✅
- Slice gates:
  - `pnpm test` ✅ (`51` files, `307` tests passed)
  - `pnpm build` ✅
  - `pnpm check:deadcode` ✅ (passes with existing knip configuration hints only)
