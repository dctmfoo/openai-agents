# 34 — Parent-controlled models, capabilities, and multi-scope memory (planning spec)

- Status: `DRAFT` (planning only, no implementation in this spec)
- Date: `2026-02-16`
- Owner: `unassigned`
- Primary slice set: `plan/slices/S13/`

## 1) Functional goal (what should work for your family)

This plan targets a family-ready runtime where:

1. Parents can use all available tools by default.
2. Children start with tools off by default, but parents can enable specific capabilities.
3. Model selection is configurable per role/scope/member and sourced from OpenAI (not hardcoded in app logic).
4. Parents can change model/capabilities from:
   - Tauri admin dashboard, and
   - Telegram parent DM controls.
5. Family chat supports parents + children with mention-based bot replies.
6. Memory never leaks across private boundaries (especially parent private memory into child-visible contexts).
7. Child privacy behavior is profile-driven and extensible (not locked to fixed hardcoded age enums).

## 2) Concise requirement restatement (from Wags)

- Remove ad-hoc model knobs like `SHELL_MODEL`; provide a proper model policy system.
- Default to a model that can handle the enabled tool surface for the actor/context.
- Parent should be able to switch to compatible models in Telegram parent chat.
- Parent should be able to enable/disable child capabilities from admin dashboard.
- Enable family onboarding for parent + co-parent + children with scoped behavior.
- Add mixed family group behavior with mention routing and strict memory boundaries.
- Design a robust multi-level memory system:
  - parent private,
  - shared/open memory,
  - child private/shared depending on profile (e.g. <13 vs 13+).
- Ensure OpenAI official docs are always consulted and referenced when implementing OpenAI behavior.

## 3) Deep-dive findings from current codebase

### 3.1 Why `gpt-4.1` happened

- `src/prime/prime.ts` currently builds `new Agent({...})` without a guaranteed explicit model in baseline flow.
- OpenAI Agents SDK default model applies when model is omitted.
- SDK sources confirm default resolution behavior:
  - `@openai/agents-core/dist/defaultModel.js` returns `OPENAI_DEFAULT_MODEL ?? 'gpt-4.1'`.
  - `@openai/agents-core/dist/agent.d.ts` also documents default model behavior.

### 3.2 Current policy/capability reality

- Tool defaults are hardcoded in `src/policies/toolPolicy.ts` (`PARENT_ALLOWLIST`, `CHILD_ALLOWLIST`).
- Parent default is **not** all tools today.
- Child defaults are hardcoded by age enum (`child|teen|young_adult`).
- Shell access requires both:
  - `tools.shell.enabled`, and
  - `tools.access` allowlist including `shell`.

### 3.3 Current admin controls are read-heavy, not policy-write controls

- `src/gateway/admin.ts` exposes status, sessions, distill, sync, retention actions.
- It does **not** provide authoritative endpoints to mutate role/member model policy and child capability toggles.
- `apps/admin/frontend/main.js` currently renders status/sessions/policy info but not parent control workflows for model/capability policy.

### 3.4 Telegram policy limitations vs requested workflow

- `src/interfaces/telegram/policy.ts` supports:
  - DMs for known members,
  - one `parents_group` where children are denied.
- There is no family mixed group policy with mention-only behavior.
- `src/interfaces/telegram/bot.ts` currently processes allowed group text directly (not mention-gated for a mixed parent+child family group mode).

### 3.5 Memory model limitation vs requested privacy tiers

- Scoped memory is currently one namespace per `scopeId` (`src/memory/scopedMemory.ts`).
- Distillation writes only by scope (`src/memory/distillationRunner.ts`).
- Semantic index/search is per scope (`src/memory/semanticMemory.ts`, `src/tools/semanticSearchTool.ts`) and lacks visibility tags/audience-class filtering.
- This is insufficient for “private vs shared” memory partitions inside the same actor/group context.

## 4) OpenAI docs + API evidence used for planning

## 4.1 OpenAI Agents SDK docs (official)

From `https://openai.github.io/openai-agents-js/guides/models`:

- Default model is currently `gpt-4.1` when model is not specified.
- `OPENAI_DEFAULT_MODEL` is supported as global default override.
- Runner-level default model configuration is supported.

From `https://openai.github.io/openai-agents-js/guides/tools`:

- Hosted tools are OpenAI Responses API tools.
- Shell tool behavior is explicit and can run local or hosted depending on `shellTool()` configuration.

## 4.2 OpenAI API surface evidence

- OpenAI `/models` list/retrieve exposes basic metadata only (id/object/created/owner), no tool-capability matrix:
  - verified in generated official SDK source (`openai/src/resources/models.ts`).
- Therefore, tool compatibility cannot be derived purely from `/models` metadata.
- Compatibility needs a probe layer (minimal Responses calls) or an external authoritative compatibility endpoint (if introduced later).

## 4.3 Live compatibility probes run during planning

Using minimal `responses.create` probes for selected models:

- `web_search_preview` accepted on tested models (`gpt-4.1`, `gpt-4.1-mini`, `gpt-5`, `gpt-5-mini`, `gpt-5.1`, `o4-mini`).
- `shell` accepted in tested set only on `gpt-5.1`; others returned `400 Tool 'shell' is not supported ...`.

Implication: model/tool compatibility must be runtime-checked and policy-driven.

## 5) Recommended architecture direction

## 5.1 Model selection (no hardcoded model IDs in business logic)

Introduce a **Model Catalog + Capability Resolver**:

1. Fetch available models from OpenAI `/models`.
2. Probe required tool bundles using lightweight Responses calls.
3. Cache support matrix with TTL.
4. Resolve default model by required capability set per actor/scope.

Policy resolution order:
1. Explicit scope/member override (if any)
2. Role/profile default policy
3. Capability-compatible best candidate from catalog
4. Safe fallback + explicit operator-visible error if none compatible

## 5.2 Capability policy v2

- Parent defaults: all registered capabilities enabled (subject to explicit blocklist if configured).
- Child defaults: all optional capabilities disabled.
- Parent can enable child capabilities per child/profile/scope from dashboard and Telegram parent controls.

## 5.3 Family scope/policy v2

Add mixed family-group support with strict routing:

- Bot replies only when mentioned (or direct reply to bot message).
- Access policy is speaker-aware + audience-aware.
- Parents-group and family-group remain distinct policy scopes.

## 5.4 Memory model v2 (audience-safe)

Add multi-level memory channels with visibility tags and retrieval filters:

- Parent private
- Parent shared/open
- Child shared (all child profiles)
- Child private (for profiles that allow it, e.g. 13+)
- Group shared memory

Retrieval must enforce context visibility so child-visible contexts never include parent-private chunks.

## 5.5 Child profile extensibility

Replace fixed `ageGroup` enum dependency with configurable child profiles.

Profiles should define:
- capability defaults,
- memory topology (shared/private),
- transcript visibility rules,
- future-safe extensibility (new profiles without TS union surgery).

## 6) Options considered (and recommendation)

### Option A: hardcoded approved model list per tool set
- Fastest
- Not acceptable long-term (drifts, brittle)

### Option B: config-only manual model names
- Flexible for operator
- Still weak safety; no automatic compatibility proof

### Option C (recommended): OpenAI model catalog + probe-backed compatibility matrix
- Sourced from OpenAI list + direct API compatibility checks
- Supports operator control + safe default auto-selection
- Best fit for “future all-tools model” direction

## 7) Acceptance criteria (functional)

1. Parent DM works out-of-the-box with all parent-default capabilities.
2. Child DM starts with restricted capabilities until parent enables selected ones.
3. Parent can change model from dashboard and Telegram parent controls.
4. In family group, bot responds only on mention and respects speaker-context permissions.
5. Parent-private facts never appear in child-visible contexts.
6. 13+ child private memory is not retrieved in group responses unless policy explicitly allows.
7. Child profile categories are config-extensible.
8. All OpenAI model/tool behavior claims in PRs are backed by docs + probe evidence.

## 8) Out of scope for this planning track

- Full production RBAC / auth for public admin endpoints.
- Cross-provider routing beyond OpenAI model catalog.
- Voice policy design.

## 9) Slice execution map

Implementation is decomposed in `plan/slices/S13/`:

1. `S13-01` model catalog + capability probe contract
2. `S13-02` model policy schema + resolver
3. `S13-03` capability policy defaults + child toggle model
4. `S13-04` parent config mutation service + admin write API
5. `S13-05` Tauri parent controls UX
6. `S13-06` Telegram parent command controls
7. `S13-07` family group mention routing + scope policy
8. `S13-08` child profile extensibility
9. `S13-09` multi-level memory + semantic visibility filters
10. `S13-10` migration/docs/phase gate
