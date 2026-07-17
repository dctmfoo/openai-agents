# Configuration

> Last updated: 2026-02-19

This project uses a primary v2 config path and a legacy v1 path.

## v2 (Primary): control-plane.json

The v2 control plane is the primary configuration path for new setups. It defines family members, profiles, capability tiers, memory lane policies, model policies, and safety policies in a single file.

Template: `config/control-plane.example.json`

### Bootstrap

```bash
cp config/control-plane.example.json ~/.halo/config/control-plane.json
# edit the file: update members, telegramUserIds, telegramChatId for groups
```

Then point `config.json` to it via the `controlPlane` loader block (see [config.json `controlPlane` block](#configjson-controlplane-block)).

### control-plane.json structure

```json
{
  "schemaVersion": 2,
  "policyVersion": "v2.0.0",
  "familyId": "default",
  "activeProfileId": "local-family",
  "profiles": [
    {
      "profileId": "parent_default",
      "role": "parent",
      "capabilityTierId": "parent_dm",
      "memoryLanePolicyId": "parent_lane",
      "modelPolicyId": "parent_model",
      "safetyPolicyId": "parent_safety"
    }
  ],
  "members": [
    {
      "memberId": "wags",
      "displayName": "Wags",
      "role": "parent",
      "profileId": "parent_default",
      "telegramUserIds": [889348242]
    }
  ],
  "scopes": [
    { "scopeId": "telegram:parents_group", "scopeType": "parents_group", "telegramChatId": null },
    { "scopeId": "telegram:family_group",  "scopeType": "family_group",  "telegramChatId": null }
  ],
  "capabilityTiers": {
    "parent_dm": ["chat.respond", "tools.shell", "tools.web_search"]
  },
  "memoryLanePolicies": {
    "parent_lane": {
      "readLanes":  ["parent_private:wags", "parents_shared", "family_shared"],
      "writeLanes": ["parent_private:wags", "parents_shared"]
    }
  },
  "modelPolicies": {
    "parent_model": { "tier": "parent_default", "model": "gpt-5.1", "reason": "parent_dm_default" }
  },
  "safetyPolicies": {
    "parent_safety": { "riskLevel": "low", "escalationPolicyId": "none" }
  }
}
```

### Top-level fields

- `schemaVersion`: must be `2` for v2 control plane
- `policyVersion`: free-form policy version string (e.g. `"v2.0.0"`)
- `familyId`: stable household identifier
- `activeProfileId`: currently active global profile (used for group-level defaults)
- `profiles`: array of named profiles — each profile links a role to capability/memory/model/safety policies
- `members`: array of family members with `profileId` references (must match a `profiles` entry)
- `scopes`: list of Telegram group scopes with their `telegramChatId` values
  - `scopeType: "parents_group"` — parents-only group
  - `scopeType: "family_group"` — whole-family group (mention-gated)

### profiles

Each profile links a role to the four policy IDs:

| Field | Description |
|-------|-------------|
| `profileId` | Unique name referenced by members |
| `role` | `parent` or `child` |
| `capabilityTierId` | Key into `capabilityTiers` |
| `memoryLanePolicyId` | Key into `memoryLanePolicies` |
| `modelPolicyId` | Key into `modelPolicies` |
| `safetyPolicyId` | Key into `safetyPolicies` |

### capabilityTiers

Maps tier ID → array of allowed capability strings.

Built-in capabilities:
- `chat.respond` — basic DM response
- `chat.respond.group_safe` — group chat response (used in parents_group / family_group)
- `tools.web_search` — hosted web search tool
- `tools.shell` — shell tool (parent only, must be enabled in config.json `tools.shell`)

### memoryLanePolicies

Maps policy ID → `{ readLanes, writeLanes }`.

Lane naming convention:
- `parent_private:<memberId>` — private to one parent
- `parents_shared` — shared among all parents
- `child_private:<memberId>` — private to one child
- `child_shared` — shared among all children
- `family_shared` — household-wide

### modelPolicies

Maps policy ID → `{ tier, model, reason }`.

- `tier`: logical tier name (e.g. `"parent_default"`, `"child_default"`)
- `model`: OpenAI model string (e.g. `"gpt-5.1"`, `"gpt-5.1-mini"`)
- `reason`: free-form label surfaced in audit logs

### safetyPolicies

Maps policy ID → `{ riskLevel, escalationPolicyId }`.

- `riskLevel`: `"low"` | `"medium"` | `"high"`
- `escalationPolicyId`: escalation label (e.g. `"none"`, `"minor_default"`)

Medium-risk child requests trigger `requires_parent_approval` by default (configurable via `profilePolicies` overrides in the DecisionEnvelope input).

---

## config.json `controlPlane` block

`config.json` acts as a loader that points to the active control plane file:

```json
{
  "controlPlane": {
    "activeProfile": "v2",
    "profiles": {
      "legacy": { "path": "config/family.json" },
      "v2":     { "path": "config/control-plane.json" }
    }
  }
}
```

- `activeProfile`: which profile to load (`"v2"` for the control plane, `"legacy"` for v1)
- `profiles`: map of profile name → `{ path }` (relative to `HALO_HOME` or absolute)

Switch between v1 and v2 by changing `activeProfile` (or use the env var override).

---

## Environment variable overrides

| Variable | Effect |
|----------|--------|
| `HALO_HOME` | Runtime root (default `~/.halo`) |
| `HALO_CONTROL_PLANE_PATH` | Direct path to control plane file (bypasses `config.json` loader) |
| `HALO_CONTROL_PLANE_PROFILE` | Override the `activeProfile` value in `config.json` at runtime |
| `GATEWAY_HOST` | Override `gateway.host` |
| `GATEWAY_PORT` | Override `gateway.port` |
| `LOG_DIR` | Override the log directory |
| `SQLITE_VEC_EXT` | sqlite-vec extension path for semantic memory |
| `HALO_COMPACTION_ENABLED` | Toggle compaction defaults in CLI/dev |
| `HALO_DISTILLATION_ENABLED` | Toggle distillation defaults in CLI/dev |

---

## v1 (Legacy): family.json

The v1 `family.json` format still works and will be loaded when `activeProfile` points to it (or when no `controlPlane` block exists in `config.json`).

```json
{
  "schemaVersion": 1,
  "familyId": "default",
  "members": [
    {
      "memberId": "wags",
      "displayName": "Wags",
      "role": "parent",
      "telegramUserIds": [889348242]
    }
  ],
  "parentsGroup": { "telegramChatId": null }
}
```

Fields:
- `schemaVersion`: `1`
- `familyId`: string
- `members[]`: list of members
  - `memberId`, `displayName`, `role` (`parent` | `child`)
  - `ageGroup`: required for children (`child` | `teen` | `young_adult`)
  - `parentalVisibility`: optional, allow parents to see child transcripts
  - `telegramUserIds`: array of Telegram user IDs
- `parentsGroup.telegramChatId`: optional approved group chat id (Telegram group IDs are **negative**)

Note: `config.json` no longer embeds `family`; policy lives only in the config file pointed to by the `controlPlane` loader.

---

## config.json full structure

```json
{
  "schemaVersion": 1,
  "gateway": { "host": "127.0.0.1", "port": 8787 },
  "features": {
    "compactionEnabled": false,
    "distillationEnabled": false
  },
  "memory": {
    "distillationEveryNItems": 20,
    "distillationMaxItems": 200,
    "distillationMode": "deterministic"
  },
  "childSafe": {
    "enabled": true,
    "maxMessageLength": 800,
    "blockedTopics": []
  },
  "semanticMemory": {
    "enabled": true,
    "embeddingProvider": "openai",
    "embeddingModel": "text-embedding-3-small",
    "embeddingDimensions": 1536,
    "syncIntervalMinutes": 15,
    "search": {
      "fusionMethod": "rrf",
      "vectorWeight": 0.7,
      "textWeight": 0.3,
      "minScore": 0.005
    }
  },
  "fileMemory": { "enabled": false },
  "controlPlane": {
    "activeProfile": "v2",
    "profiles": {
      "legacy": { "path": "config/family.json" },
      "v2":     { "path": "config/control-plane.json" }
    }
  },
  "tools": {
    "shell": { "enabled": false, "timeoutMs": 30000, "maxOutputLength": 4096 }
  }
}
```

See `config/halo.example.json` for the full annotated template.

### gateway
- `host`: bind address (default `127.0.0.1`)
- `port`: bind port (default `8787`)

### features
- `compactionEnabled`: enable OpenAI Responses API compaction
- `distillationEnabled`: enable memory distillation

### memory
- `distillationEveryNItems`: trigger distillation after N transcript items (default `20`)
- `distillationMaxItems`: max items to consider when distilling (default `200`)
- `distillationMode`: `deterministic` or `llm`

### childSafe
- `enabled`: apply child-safe response filtering
- `maxMessageLength`: cap child responses (characters)
- `blockedTopics`: additional blocked topics (strings)

### semanticMemory
- `enabled`: toggle semantic memory indexing + search
- `embeddingProvider`: `openai` or `gemini`
- `embeddingModel`: provider model name
- `embeddingDimensions`: embedding size
- `vecExtensionPath`: optional override for sqlite-vec extension path
- `syncIntervalMinutes`: background sync cadence for active scopes
- `search`: scoring weights and minimum relevance

Requirements:
- `SQLITE_VEC_EXT` (or `vecExtensionPath`) must point to the sqlite-vec extension.
- `OPENAI_API_KEY` is required for OpenAI embeddings.
- `GEMINI_API_KEY` is required for Gemini embeddings.

### fileMemory

See `config/halo.example.json` for the full `fileMemory` block. Key fields:
- `enabled`: enables scoped file-memory behavior and file-search tool wiring
- `uploadEnabled`: enables Telegram document upload ingestion
- `retention.policyPreset`: `all`, `parents_only`, `exclude_children`, or `custom`

---

## nodes.json (future)

Defines nodes and which member they belong to.

Fields:
- `schemaVersion`: number
- `nodes[]`: list of nodes

A node is a capability boundary for a member. Even when Core and the parent node run on the same machine, Core routes via the node abstraction.
