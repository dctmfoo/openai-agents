# Policies

> Last updated: 2026-02-19

This document defines the policy baseline for a family-first companion.

Policy is implemented as code (pure functions) and kept easy to unit test.

---

## v2 Policy Engine (Current)

The v2 engine evaluates every incoming request through a **DecisionEnvelope pipeline** — a 5-step pure-function chain that produces a typed decision envelope.

### DecisionEnvelope output

Every request resolves to a `DecisionEnvelope` with:

| Field | Description |
|-------|-------------|
| `action` | `allow` \| `deny` \| `requires_parent_approval` |
| `allowedCapabilities` | List of capabilities granted for this request |
| `allowedMemoryReadLanes` | Lane IDs Prime may read from |
| `allowedMemoryWriteLanes` | Lane IDs Prime may write to |
| `modelPlan` | `{ tier, model, reason }` — which model to use |
| `safetyPlan` | `{ riskLevel, escalationPolicyId }` |
| `rationale` | Ordered list of rule labels explaining the decision |

### The 5-step pipeline

```
safetySignal → scopeResolution → roleProfile → overrides → compatibility
```

#### Step 1: safety

Evaluates the optional `safetySignal.riskLevel` input.

- `low` / `medium` — continue to next step
- `high` + parent role — hard deny (`safety_high_risk_hard_deny`)
- `high` + child role — continue; child high-risk handled in overrides step

#### Step 2: scope

Resolves the Telegram chat to a scope type and scope ID.

| Chat type | Condition | Scope type | Result |
|-----------|-----------|------------|--------|
| `private` | any | `dm` | always resolved |
| group | matches `parentsGroup.telegramChatId` | `parents_group` | resolved |
| group | matches `family_group.telegramChatId` | `family_group` | resolved |
| group | no match | — | deny (`group_not_approved`) |
| `parents_group` | sender is child | — | deny (`child_in_parents_group`) |
| `family_group` | `isMentioned` is false | — | deny (`mention_required_in_family_group`) |

DM scope ID is rewritten from `telegram:dm:<rawTelegramId>` to `telegram:dm:<memberId>` at this step.

#### Step 3: role_profile

Builds the base policy plan based on role and scope type.

| Scope | Capabilities | Memory lanes |
|-------|-------------|--------------|
| `dm` | `["chat.respond"]` (+ profile capabilities from `capabilityTiers`) | From `memoryLanePolicies` for member's profile |
| `parents_group` | `["chat.respond.group_safe"]` | `["parents_shared"]` read + write |
| `family_group` (mentioned) | `["chat.respond.group_safe"]` | `["family_shared"]` read + write |

Model plan: resolved from `modelPolicies[profile.modelPolicyId]` in the control plane. Falls back to hardcoded tier defaults when no v2 config is present.

#### Step 4: overrides

Applies risk-level and explicit capability/model overrides.

- **medium-risk child**: action may escalate to `requires_parent_approval` (default: yes for children)
  - Configurable via `profilePolicies[profileId].mediumRiskParentNotificationDefault`
  - Overridable per-request via `overrides.mediumRiskParentNotification`
- **high-risk child**: action becomes `requires_parent_approval` (or `deny` if notification disabled)
  - Configurable via `profilePolicies[profileId].highRiskParentNotificationDefault`
  - Escalation policy configurable via `profilePolicies[profileId].highRiskEscalationPolicyId`
- **capability additions/removals**: `overrides.capabilityAdditions` / `overrides.capabilityRemovals`
- **model override**: `overrides.model` replaces the model in the plan

#### Step 5: compatibility

Ensures the selected model supports the granted capabilities.

- Checks `compatibility.supportedCapabilitiesByModel[model]` for the current model
- If the model does not support the capabilities, looks up `compatibility.fallbackModelByTier[tier]`
- Falls back to the fallback model if it supports the capabilities (rationale: `compatibility_fallback_model`)

---

## Roles

- `parent`
- `child`

---

## Scopes

| Scope type | Description |
|------------|-------------|
| `dm` | Private DM between a member and Prime |
| `parents_group` | Parents-only Telegram group |
| `family_group` | Whole-family Telegram group; Prime only responds when mentioned |

---

## Capability system

Capabilities are string tokens that control what Prime is allowed to do in a given request. They are configured per profile via `capabilityTiers` in `control-plane.json`.

| Capability | Meaning |
|-----------|---------|
| `chat.respond` | Prime may respond to DM messages |
| `chat.respond.group_safe` | Prime may respond in group chats |
| `tools.web_search` | Web search tool enabled |
| `tools.shell` | Shell tool enabled (parent only; also requires `tools.shell.enabled` in config.json) |

---

## Memory lanes

Lane access is resolved per-request by the DecisionEnvelope. The `allowedMemoryReadLanes` and `allowedMemoryWriteLanes` fields control which lanes Prime may access.

Lane naming convention:
- `parent_private:<memberId>` — private to one parent
- `parents_shared` — shared among all parents
- `child_private:<memberId>` — private to one child
- `child_shared` — shared among all children
- `family_shared` — household-wide

Lane assignments are configured in `memoryLanePolicies` per profile in `control-plane.json`. Default templates (used when no v2 config is present):

| Profile | Read lanes | Write lanes |
|---------|-----------|-------------|
| `parent_default` | `parent_private:{memberId}`, `parents_shared`, `family_shared` | `parent_private:{memberId}`, `parents_shared` |
| `young_child` / `adolescent` / `child_default` | `child_private:{memberId}`, `child_shared` | `child_private:{memberId}` |

---

## `family_group` scope

The `family_group` scope enables a whole-family Telegram group chat. Key behaviors:

- Prime only responds when **@mentioned** in the group
- Mention-gating is enforced at the scope step: `mention_required_in_family_group`
- Memory lanes default to `["family_shared"]` for both reads and writes
- Capabilities default to `["chat.respond.group_safe"]`
- Any family member may participate (unlike `parents_group` which excludes children)

Configure the group's Telegram chat ID in `control-plane.json`:

```json
{
  "scopes": [
    { "scopeId": "telegram:family_group", "scopeType": "family_group", "telegramChatId": -100123456789 }
  ]
}
```

---

## `modelPlan` — per-member model selection

The `modelPlan` in the DecisionEnvelope controls which model runs for this request:

```json
{
  "tier": "parent_default",
  "model": "gpt-5.1",
  "reason": "parent_dm_default"
}
```

Model selection order:
1. `modelPolicies[profile.modelPolicyId]` from `control-plane.json` (if v2 config loaded)
2. Hardcoded tier defaults: `parent_default` → `gpt-4.1`, `child_default` → `gpt-4.1-mini`
3. Compatibility fallback (step 5) may substitute a different model

---

## Risk-level escalation

| Risk level | Parent role | Child role (default) |
|-----------|-------------|----------------------|
| `low` | allow | allow |
| `medium` | allow | `requires_parent_approval` |
| `high` | deny (hard) | `requires_parent_approval` |

"Requires parent approval" means Prime does not respond until a parent approves the request. The exact escalation policy is stored in `safetyPlan.escalationPolicyId`.

---

## Scope ID format

Scope IDs are deterministic strings used to isolate sessions and memory:
- DM scope: `telegram:dm:<memberId>` (e.g., `telegram:dm:wags`)
- Parents group scope: `telegram:parents_group:<chatId>` (e.g., `telegram:parents_group:-123456789`)
- Family group scope: `telegram:family_group:<chatId>` (e.g., `telegram:family_group:-987654321`)

These scope IDs are hashed (SHA256) to derive file paths for sessions, transcripts, and memory.

---

## Transcripts and clear/purge semantics

- Transcripts are append-only JSONL under `HALO_HOME/transcripts`.
- Derived session state (summaries/compactions) is stored separately under `HALO_HOME/sessions`.
- Admin **Clear** clears only derived session state (keeps transcript history).
- Admin **Purge** deletes both derived session state and transcripts (loopback-only + confirmation required).

---

## v1 Action matrix (Legacy reference)

The v1 policy used a simple action matrix. It is still supported when loading `family.json` (schemaVersion 1).

Legend: ✅ allow, ❌ deny

### Messaging
- parent in dm: ✅
- child in dm: ✅
- parent in parents_group: ✅
- child in parents_group: ❌ (group should not include children)

### Memory writeback (files)
- parent in dm: ✅ (private)
- child in dm: ✅ (private)
- parent in parents_group: ✅ (shared among parents)
- child in parents_group: ❌

### Tool execution
Default stance: deny-by-default; allow only explicitly via capability tiers.

- child tools: deny unless specifically safe/read-only
- parent tools: allowed only via explicit allowlist

### Adapter enforcement (v1)

The Telegram adapter loads family config and caches it for the life of the process (restart to pick up changes). The admin `/policy/status` endpoint reads the same config.

- Unknown DMs receive a short refusal message and do not create a session.
- Non-private chats are ignored unless they match a configured group chat ID and the sender is a known member.
- Children in the approved parents-group are silently denied (no reply).
