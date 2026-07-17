# 35 — 2026-02-17 — V2 policy/control-plane reset (production-shaped in dev)

- Status: `DRAFT` (planning-only; no implementation in this doc)
- Owner: `Wags + contributors`
- Active slice set: `plan/slices/S1/`

## 1) Decision summary

Recommended approach: **selective hard reset**.

- Keep reusable infra (sessions, transcripts, indexing primitives, tooling/test harness).
- Replace policy architecture end-to-end with V2 control-plane + decision envelope.
- No dual old/new policy execution path.

This matches `docs/18-policy-control-plane-blueprint.md`.

## 2) Functional goals

1. Deterministic policy envelope per message before model/tool execution.
2. Role/profile/scope-aware behavior for: parent, co-parent, 16-year-old, 9-year-old.
3. Family-group mention-gated behavior with group-safe outputs.
4. Strong memory lane boundaries (no private leakage).
5. Retrieval/RAG prefiltering by allowed lanes/scopes only.
6. Safety handling for sensitive topics with low/medium/high risk routing.

## 3) Hard invariants (must not regress)

1. No retrieval from disallowed lanes.
2. No tool call before policy envelope resolution.
3. Group output never leaks parent-private or child-private DM details.
4. Safety high-risk paths block dangerous specifics.
5. Every decision is observable with rationale.

## 4) Baseline and gap summary

### Reuse candidates
- Session + transcript persistence pipeline
- Semantic/file indexing foundations
- Runtime/admin scaffolding and test harness

### Replace candidates
- Telegram policy resolution (`dm`/`parents_group` only)
- Tool policy defaults with hardcoded role+age behavior
- Heuristic-only child response filter as primary safety boundary
- Missing memory lane and retrieval prefilter contract

## 5) Target architecture contract (phase 1)

1. **Control-plane schema** (canonical policy source)
2. **Decision envelope resolver** (allow/deny/escalate + rationale)
3. **Memory lane read/write guards**
4. **Capability + model policy resolver**
5. **Safety policy resolver** (risk-level routing)
6. **RAG/file-search lane prefilter enforcement**

## 6) TDD slice map

See `plan/slices/S1/`:

1. `S1-01` Decision envelope contract + red scenario tests
2. `S1-02` Control-plane schema + loader
3. `S1-03` Capability/model/safety policy resolver
4. `S1-04` Memory lane read/write enforcement
5. `S1-05` Retrieval/RAG + file-search lane prefiltering
6. `S1-06` Telegram integration + phase gate

## 7) Verification discipline

### Focused checks during slices
- Run module-focused tests listed in each slice doc.

### Full handoff gate after each completed slice
```bash
pnpm test
pnpm build
pnpm check:deadcode
```

For policy-heavy slices, also run:
```bash
pnpm check:complexity
```

## 8) Risks and mitigations

1. **Risk:** partial migration causes split-brain policy behavior.
   - **Mitigation:** one resolver path; remove old policy hookups slice-by-slice.
2. **Risk:** retrieval leakage during transition.
   - **Mitigation:** enforce lane prefilter before any retrieval call and add explicit tests.
3. **Risk:** delivery slowdown due to broad scope.
   - **Mitigation:** strict slice boundaries + one-slice-per-commit discipline.

## 9) Out of scope (phase 1)

- UI-heavy policy management UX beyond minimal admin observability
- multi-provider model routing beyond OpenAI-first resolver
- non-Telegram channel policy parity

## 10) Canonical references

- Blueprint: `docs/18-policy-control-plane-blueprint.md`
- Discussion context: `docs/17-family-architecture-discussion-in-progress.md`
- OpenAI docs used by policy foundation:
  - https://openai.github.io/openai-agents-js/guides/models
  - https://openai.github.io/openai-agents-js/guides/guardrails/
  - https://developers.openai.com/api/docs/guides/moderation
  - https://developers.openai.com/api/docs/guides/safety-best-practices
  - https://developers.openai.com/api/docs/guides/agent-builder-safety
  - https://developers.openai.com/api/docs/guides/tools-shell
  - https://developers.openai.com/api/docs/guides/tools-skills
  - https://developers.openai.com/api/docs/guides/context-management
