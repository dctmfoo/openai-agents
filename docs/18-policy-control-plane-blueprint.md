# 18) Family Policy + Control Plane Blueprint (V2 Foundation)

**Status:** PROPOSED (lock this before major refactor)  
**Owner:** Wags + contributors  
**Last updated:** 2026-02-17

---

## 1) Purpose of this document

This is the **blueprint contract** for the next architecture.

Everything depends on this layer:
- policy decisions,
- memory visibility,
- tool access,
- model selection,
- file search / RAG retrieval boundaries,
- safety and escalation behavior.

### Decision stance

For V2, we are optimizing for a production-shaped foundation now (not a conservative patch path):
- allow breaking changes,
- avoid dual old/new policy logic,
- keep one clear control-plane model.

---

## 2) Real-family baseline (functional anchor)

Target baseline family for policy design:
- Parent A
- Parent B
- Child (16, teen)
- Child (9, child)

Primary contexts:
- each member DM with Halo,
- parents-only group,
- family mixed group (parents + children + Halo).

Deployment baseline:
- local family-owned runtime on parent-controlled machine.

---

## 3) Non-negotiable invariants

1. **No private-memory leakage across lanes.**
2. **Policy is enforced in code (not prompt-only).**
3. **Retrieval is pre-filtered by allowed lanes/scopes before generation.**
4. **Group responses are safe for everyone present.**
5. **Every run produces a deterministic decision envelope + rationale.**
6. **Children default to restricted capabilities; parent can explicitly elevate.**
7. **No hardcoded age thresholds in logic; profile policies drive behavior.**

---

## 4) Runtime decision envelope (required contract)

For every incoming message, resolve one envelope before any model call:

```ts
{
  policyVersion: string;
  speaker: { memberId: string; role: "parent" | "child"; profileId: string };
  scope: { scopeId: string; scopeType: "dm" | "parents_group" | "family_group" };
  intent: { isMentioned: boolean; command?: string };

  action: "allow" | "deny" | "requires_parent_approval";

  allowedCapabilities: string[];
  allowedMemoryReadLanes: string[];
  allowedMemoryWriteLanes: string[];

  modelPlan: { tier: string; model: string; reason: string };
  safetyPlan: { riskLevel: "low" | "medium" | "high"; escalationPolicyId: string };

  rationale: string[];
}
```

No tool, retrieval, or model execution happens before this envelope is computed.

---

## 5) V2 policy primitives

1. **Identity**: members, roles, profiles, Telegram IDs.
2. **Scope**: DM, parents group, family group.
3. **Capability policy**: tool/skill tier by role+profile+scope.
4. **Memory lane policy**: read/write allow rules by role+profile+scope.
5. **Model policy**: model tier + compatibility fallback rules.
6. **Safety policy**: risk classification and escalation actions.
7. **Decision tracing**: explain why a decision was made.

---

## 6) V1 functional policy set (80% flows)

Profile note:
- Age examples below reflect current household discussion only.
- Runtime behavior must come from configurable profile policies (not hardcoded age checks).

### A) Parent DM
- Allow response.
- Parent capability tier.
- Parent model tier.
- Read/write: parent lanes + family-shared.

### B) Child DM (example profile: `young_child`)
- Allow response.
- Young-child capability/model policy tier.
- Homework and normal learning: fully supported.
- High-risk safety topics: safe response + parent escalation policy applies.

### C) Child DM (example profile: `adolescent`)
- Allow response.
- Adolescent capability/model policy tier (still safety-constrained).
- Sensitive topics use risk-based handling (below).

### D) Parents group (mention-gated)
- Allow only for parent speakers.
- Parent group-safe capability tier.
- Shared parent/group memory only.

### E) Family mixed group (mention-gated)
- Respond only when mentioned.
- Group-safe capability tier regardless of speaker.
- Never expose private DM details from any member lane.
- Redirect private/sensitive detail to appropriate DM when needed.

### F) Unknown user
- DM: short refusal.
- Group: no response.

---

## 7) Sensitive-topic handling policy (profile-driven)

Use 3-level risk classification:

### Low risk
Examples: stress, study pressure, social conflict.
- Provide age-appropriate advice.
- No escalation.

### Medium risk
Examples: sexual-health curiosity, emotional distress without immediate danger, substance curiosity.
- Provide harm-minimizing, non-graphic guidance.
- Encourage trusted adult/pro support.
- Parent notification defaults are profile-configurable (recommended default-on for minor profiles).

### High risk
Examples: self-harm intent, violence intent, explicit illegal harm instructions, sexual-minors unsafe contexts.
- Refuse dangerous specifics.
- Provide immediate safety-oriented guidance.
- Trigger escalation policy (parent alert + safety guidance) per profile policy (recommended default-on for minor profiles).

---

## 8) Memory lane model (V2 baseline)

Lanes:
- `parent_private:<parentId>`
- `parents_shared`
- `child_private:<childId>`
- `child_shared`
- `family_shared`
- `system_audit` (non-user-visible)

Rules:
- Writes in DM default to that member’s private lane.
- Family group writes default to `family_shared`.
- Parents group writes default to `parents_shared`.
- Cross-lane reads are denied unless policy explicitly allows.

### Child profile privacy defaults (recommended)
- Defaults are configured per profile template (e.g., `young_child`, `adolescent`) and can be changed by parents.
- Recommended starting point:
  - younger-child profiles: parent summary visibility default-on for safety,
  - adolescent profiles: private-by-default, with escalation/summary behavior governed by safety policy.

---

## 9) File search / RAG policy blueprint

Every document/chunk must carry policy metadata:
- `ownerMemberId`
- `scopeId`
- `laneId`
- `visibilityClass`
- `policyVersion`

Retrieval contract:
1. Build candidate set from **allowed lanes/scopes only** (hard pre-filter).
2. Run vector/text retrieval only within allowed candidates.
3. Pass only allowed chunks into generation.
4. Block any citation/output that references disallowed lanes.

This pre-filter rule is mandatory for both:
- memory RAG,
- uploaded file search.

---

## 10) Control-plane config direction (V2)

Recommended canonical config package:
- `control-plane.json` (policy source of truth)
- `runtime.json` (infra/runtime knobs: host, ports, schedulers, etc.)

`control-plane.json` should include:
- members + profiles,
- scope definitions,
- capability tiers,
- memory lane rules,
- model policy rules,
- safety + escalation policies.

---

## 11) Policy precedence order (hard rule)

When multiple rules apply:

1. Safety hard deny / emergency policy
2. Scope constraints
3. Role/profile policy
4. Parent explicit overrides
5. Model/tool compatibility fallback

Same input must always produce the same envelope for a fixed policy version.

---

## 12) Observability requirements

Every run logs:
- envelope summary,
- selected model tier,
- allowed lanes/capabilities,
- triggered safety policy (if any),
- final action (`allow/deny/escalate`).

Admin must be able to answer: **"What happened, and why?"**

---

## 13) Build sequence from this blueprint

Execution follows the production-ready pack roadmap:
- `plan/36-2026-02-17-production-ready-pack-sequencing-plan.md`
- slice packs under `plan/slices/P1` → `plan/slices/P6`

Rules:
1. Finish one slice at a time.
2. Finish one pack at a time.
3. Do not start the next pack until current pack gates are green.
4. Keep regression scenarios from earlier packs green in later packs.

---

## 14) Immediate open decisions to lock next

1. Exact parent escalation payload/timing for high-risk minor events.
2. Profile template defaults for medium-risk notifications (younger-child vs adolescent), while keeping parent override controls.
3. Onboarding trust model details (invite TTL, re-invite, relink after account changes).
4. Retention defaults per lane + backup retention policy.
5. Export/delete semantics (format, scope, recoverability window).
6. Voice-note retry policy (retry count + timeout thresholds).

---

## 15) Reference docs used

- Agents SDK models guide:  
  https://openai.github.io/openai-agents-js/guides/models
- Agents SDK guardrails guide:  
  https://openai.github.io/openai-agents-js/guides/guardrails/
- Tools: shell guide:  
  https://developers.openai.com/api/docs/guides/tools-shell
- Tools: skills guide:  
  https://developers.openai.com/api/docs/guides/tools-skills
- Context management guide:  
  https://developers.openai.com/api/docs/guides/context-management
- Moderation guide:  
  https://developers.openai.com/api/docs/guides/moderation
- Safety best practices:  
  https://developers.openai.com/api/docs/guides/safety-best-practices
- Safety in building agents:  
  https://developers.openai.com/api/docs/guides/agent-builder-safety
