# 17) Family Architecture Discussion (In Progress)

**Status:** IN_PROGRESS (discussion-only, no implementation in this doc)  
**Owner:** Wags + contributors  
**Last updated:** 2026-02-16  
**Related blueprint:** `docs/18-policy-control-plane-blueprint.md`

---

## 1) Why this document exists

This is a **functional-first architecture discussion doc**.

Goal: agree on the right primitives and user flows before implementation, so the app is simple for families and safe by default.

---

## 2) Functional outcomes we want (plain language)

### A) Onboarding should feel simple

A parent should be able to:
- start the app,
- connect Telegram,
- invite co-parent + kids,
- enable family group behavior,
- and be operational quickly without editing raw JSON by hand.

### B) Parent control should be clear

A parent should be able to:
- enable/disable child capabilities,
- choose/change model policy for parent/child contexts,
- do this from admin dashboard (and later parent Telegram controls),
- see what is currently active and why.

### C) Memory privacy must never leak

The bot must not expose parent-private data in child-visible contexts.

Example requirement:
- Parent discussed sensitive fee details in parent DM or parent-only scope.
- In family/child-visible chat, bot can discuss “fees are high” but must not reveal exact private numbers unless policy explicitly allows.

### D) Group behavior should be predictable

In family group chats (parents + children + bot):
- bot should be mention-gated by default,
- respond based on who asked,
- use only memory lanes allowed for that speaker + scope.

---

## 3) Non-negotiable design principles

1. **Safety boundaries are code-level policy**, not prompt-only behavior.
2. **Parents default to broad capability access** (within explicit safety guardrails).
3. **Children default to restricted capabilities**; parent can opt-in extra access.
4. **Model selection must be policy-driven and compatibility-aware**, not ad-hoc hardcoding.
5. **Architecture must support extensible child profiles**, not fixed one-off branching forever.

---

## 4) OpenAI-doc-backed constraints (authoritative references)

These facts should drive architecture decisions:

1. Agents SDK default model behavior:
   - if model not explicitly set, default is `gpt-4.1` (or `OPENAI_DEFAULT_MODEL`).
   - Source: <https://openai.github.io/openai-agents-js/guides/models>

2. Shell tool execution modes:
   - hosted container mode and local shell mode are both supported.
   - Source: <https://developers.openai.com/api/docs/guides/tools-shell>

3. Hosted shell network policy:
   - outbound network is off by default;
   - org allowlist + request `network_policy` needed to enable;
   - `domain_secrets` for protected calls.
   - Source: <https://developers.openai.com/api/docs/guides/tools-shell>

4. Skills behavior:
   - skills are versioned bundles with `SKILL.md`;
   - model can choose when to invoke unless explicitly instructed.
   - Source: <https://developers.openai.com/api/docs/guides/tools-skills>

5. Long-run context handling:
   - server-side compaction and standalone `/responses/compact` are supported.
   - Source: <https://developers.openai.com/api/docs/guides/context-management>

6. Agents SDK guardrails:
   - input/output/tool guardrails are available;
   - tripwires can halt execution when unsafe behavior is detected.
   - Source: <https://openai.github.io/openai-agents-js/guides/guardrails/>

7. Moderation endpoint:
   - `omni-moderation-latest` supports text/image classification for harmful categories.
   - Source: <https://developers.openai.com/api/docs/guides/moderation>

8. Safety best practices and agent safety:
   - use layered safeguards (moderation, red-teaming, human oversight),
   - and mitigate prompt injection/private-data leakage in agent workflows.
   - Sources:
     - <https://developers.openai.com/api/docs/guides/safety-best-practices>
     - <https://developers.openai.com/api/docs/guides/agent-builder-safety>

---

## 5) Candidate architecture primitives (discussion baseline)

### 5.1 Identity primitive

Represents human actors:
- parent / co-parent / child,
- profile metadata (age/profile policy),
- channel identities (Telegram IDs, etc.).

### 5.2 Scope primitive

Represents where interaction happens:
- parent DM,
- child DM,
- parents group,
- family mixed group.

### 5.3 Capability primitive

Represents tool/skill availability policy:
- defaults by role/profile,
- overrides by parent,
- optional per-scope tuning.

### 5.4 Memory lane primitive

Represents visibility classes, e.g.:
- parent-private,
- parent-shared,
- child-private (profile dependent),
- child-shared,
- family-shared/group-shared.

### 5.5 Model policy primitive

Resolves model from:
- role/profile/scope policy,
- required capability set,
- compatibility checks,
- explicit parent override.

### 5.6 Runtime decision primitive

For each message, produce a deterministic decision envelope:
- who is speaking,
- where,
- mention intent,
- allowed capabilities,
- allowed memory lanes,
- selected model,
- rationale (for observability/admin UI).

---

## 6) Onboarding design target (functional flow)

### Step 1: Parent bootstrap
- parent verifies ownership in Telegram DM,
- app creates initial family admin principal.

### Step 2: Add family members
- parent adds co-parent/children via guided flow,
- assigns profiles (extensible categories).

### Step 3: Default policies applied automatically
- parent/co-parent: broad capabilities enabled,
- children: restricted defaults,
- memory lanes configured per profile policy.

### Step 4: Group setup
- configure parents group and family group,
- family group mention mode enabled by default.

### Step 5: Safety check screen
- show “what bot can/can’t access per context” in plain language.

---

## 7) Architecture options to decide

### Option A — Incremental patching of current config shape

Pros:
- less short-term churn.

Cons:
- risks long-term complexity and policy drift,
- still difficult onboarding UX.

### Option B — Control-plane first (recommended)

Pros:
- clear policy model,
- clean parent controls,
- better foundation for memory/model safety.

Cons:
- moderate upfront design effort.

**Current recommendation:** Option B.

---

## 8) Discussion checkpoints (to lock before coding)

1. **Profile model (locked):** use extensible profile definitions (config-driven), not hardcoded age thresholds in runtime logic.
2. **Memory lane contract:** exact lane names and which contexts can read/write each lane.
3. **Parent defaults:** define exact capability set and safety exceptions.
4. **Child defaults:** define baseline and opt-in escalation model.
5. **Family group behavior:** mention-only vs mention+reply-chain behavior.
6. **Model policy contract:** precedence order for defaults, overrides, compatibility failures.
7. **Onboarding UX contract:** minimum required steps before “family-ready”.

---

## 9) Risks we must design around early

1. **Private-memory leakage risk** via retrieval if lanes are not enforced in query path.
2. **Model/tool mismatch risk** if compatibility is not validated before run.
3. **Over-permissioned child experience** if defaults are not strict.
4. **Operational confusion** if parent can’t see why a capability/model was chosen.

---

## 10) Next discussion iteration (proposed)

In the next pass, lock these in order:

1. Functional policy matrix (who can do what, where).
2. Memory lane visibility matrix (read/write).
3. Parent onboarding wizard steps and required screens.
4. Model policy resolution order and override rules.

---

## 11) Change log

- 2026-02-16: Initial in-progress discussion draft created (functional-first baseline).
- 2026-02-17: Locked profile-model direction to extensible, config-driven profiles (no hardcoded age thresholds).
