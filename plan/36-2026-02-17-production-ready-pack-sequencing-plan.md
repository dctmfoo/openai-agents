# 36 — 2026-02-17 — Production-ready pack sequencing plan (end-to-end)

- Status: `DRAFT` (planning-only; no implementation in this doc)
- Owner: `Wags + contributors`
- Deployment profile: `local family-owned runtime` (runs on parent-controlled machine)

## 1) Why this plan exists

This roadmap replaces isolated technical slicing with **product-flow pack sequencing**.

Each pack must deliver real user-visible value while preserving policy/privacy invariants, so the product gets more complete pack by pack and ends family-ready.

## 2) Locked product decisions (from Wags)

1. Local family-run deployment (not multi-tenant hosted in phase 1).
2. Current household preference: adolescent profile default privacy is private by default.
3. Medium-risk notifications: defaults are profile-driven and parent-configurable (recommended default-on for minor profiles).
4. Per-lane retention and parent-managed deletes are required (can land in later pack, but must be designed from the start).
5. Voice-note UX: retry transcription, then clear fallback response if still unavailable.
6. Avoid “MVP shortcuts”; implementation target is production-ready quality.

## 3) End-state definition (family-ready)

After Pack 6, parent should be able to:
- onboard spouse + children,
- use DM/group interactions safely,
- rely on lane-safe memory and retrieval,
- use voice notes and file/doc retrieval without privacy leakage,
- manage retention/deletes and inspect rationale/safety events.

### Family workflow scenarios this roadmap must preserve

1. Parent DM remains private for personal/work files (e.g., payslip).
2. Spouse DM remains private and isolated from parent DM by default.
3. Parents group supports shared planning tasks and memory.
4. Child DMs support homework/media/voice flows under profile-safe policy.
5. Family group is mention-gated and uses only family-safe visible memory.
6. Parent query for child progress uses policy-approved summary visibility (not raw private transcript leakage).

## 4) Cross-pack non-negotiable invariants

1. Policy envelope resolves before tools/models/retrieval.
2. Retrieval candidates are prefiltered by allowed lanes/scopes.
3. Private-memory leakage across lanes is impossible by code path.
4. Safety escalation behavior is deterministic and auditable.
5. No hardcoded family-specific or age-threshold behavior in runtime logic; policies are config-driven/extensible.

## 5) Pack sequence (production-ready)

## Pack 1 — Control-plane core
**Outcome:** deterministic policy kernel in place.

- Control-plane schema + loader.
- Decision envelope contract + resolver.
- Baseline policy scenarios for parent/child/unknown user.
- Regression baseline tests for future packs.

## Pack 2 — Family onboarding + identity lifecycle
**Outcome:** household can be configured without manual JSON surgery.

- Parent bootstrap flow.
- Spouse/child invite + linking flows.
- Member lifecycle: add, relink, revoke, disable.
- Scope setup contract (DM, parents-group, family-group).

## Pack 3 — Conversation surfaces + group behavior
**Outcome:** production-safe DM/group behavior.

- Mention-gated family-group behavior.
- Parents-group behavior and role gating.
- Profile-driven sensitive-topic handling with configurable notifications.
- Rationale emission in runtime logs.

## Pack 4 — Memory lanes + distillation + lane indexes
**Outcome:** lane-safe memory write/read system.

- Lane-aware memory topology and metadata contract.
- Distillation pipeline to lane docs/daily logs.
- Transcript + lane indexing contract.
- Parent/child lane isolation tests.

## Pack 5 — Retrieval/file-search/voice-note pipeline
**Outcome:** multimodal retrieval works with policy safety.

- Retrieval prefilter + optional rerank/neighbor strategy hooks.
- File-search lane-aware metadata and citation guard.
- Voice-note ingestion (transcribe → same policy path) with retry/fallback UX.

## Pack 6 — Operations, retention, reliability, family-ready gate
**Outcome:** parent-operable and release-ready.

- Per-lane retention policies.
- Parent-managed delete/export controls.
- Backup/restore + failure runbooks.
- Incident/safety auditability.
- Family-ready acceptance gate across all core scenarios.

## 6) Pack completion gates (applies to every pack)

1. Pack-specific focused tests pass.
2. Full gates pass:
   - `pnpm test`
   - `pnpm build`
   - `pnpm check:deadcode`
3. No invariant regressions.
4. Pack demo checklist updated with evidence.

## 7) OpenAI references this roadmap relies on

- https://openai.github.io/openai-agents-js/guides/models
- https://openai.github.io/openai-agents-js/guides/guardrails/
- https://developers.openai.com/api/docs/guides/moderation
- https://developers.openai.com/api/docs/guides/safety-best-practices
- https://developers.openai.com/api/docs/guides/agent-builder-safety
- https://developers.openai.com/api/docs/guides/tools-shell
- https://developers.openai.com/api/docs/guides/tools-skills
- https://developers.openai.com/api/docs/guides/context-management

## 8) Supplemental architecture sanity references (non-OpenAI)

Used for operational-risk completeness checks:
- OWASP LLM Top 10: https://owasp.org/www-project-top-10-for-large-language-model-applications/
- NIST AI RMF: https://www.nist.gov/itl/ai-risk-management-framework
- NIST Incident Handling Guide: https://nvlpubs.nist.gov/nistpubs/specialpublications/nist.sp.800-61r2.pdf
