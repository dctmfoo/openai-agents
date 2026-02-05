# Configuration

This project uses **two** JSON files.

- `HALO_HOME/config.json` (gateway runtime settings, required for `pnpm start:gateway`)
- `HALO_HOME/config/family.json` (Telegram policy + `/policy/status`)

Examples:
- `config/halo.example.json`
- `config/family.example.json`

## Bootstrap

Recommended:

```bash
pnpm halo:config:init
```

Manual:

```bash
cp config/halo.example.json ~/.halo/config.json
mkdir -p ~/.halo/config
cp config/family.example.json ~/.halo/config/family.json
# edit both files
```

Notes:
- `TELEGRAM_BOT_TOKEN` stays in the environment (don't put secrets in config.json).
- `config.json` no longer embeds `family`; family policy lives only in `config/family.json`.

## Principles

- Keep configs small and explicit.
- Validate with Zod at startup.
- Version configs with `schemaVersion`.

## config.json structure

```json
{
  "schemaVersion": 1,
  "gateway": {
    "host": "127.0.0.1",
    "port": 8787
  },
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
  }
}
```

### gateway

- `host`: bind address (default `127.0.0.1`)
- `port`: bind port (default `8787`)

### features

- `compactionEnabled`: enable OpenAI Responses API compaction (default `false` in config file)
- `distillationEnabled`: enable memory distillation (default `false`)

Notes:
- When running via the gateway (`pnpm start:gateway`), the config file values are used.
- `HALO_COMPACTION_ENABLED` and `HALO_DISTILLATION_ENABLED` only affect SessionStore defaults when it is instantiated without explicit options (CLI/dev paths).
- SessionStore defaults also auto-enable compaction when `OPENAI_API_KEY` is set, unless you pass explicit options.

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
- `syncIntervalMinutes`: how often to sync markdown -> vector store
- `search`: scoring weights and minimum relevance

Requirements:
- `SQLITE_VEC_EXT` (or `vecExtensionPath`) must point to the sqlite-vec extension.
- `OPENAI_API_KEY` is required for OpenAI embeddings.
- `GEMINI_API_KEY` is required for Gemini embeddings.

## family.json structure

Defines family members and the parents-only group.

Fields:
- `schemaVersion`: number
- `familyId`: string
- `members[]`: list of members
  - `memberId`: stable identifier (e.g. `wags`)
  - `displayName`: human-readable name
  - `role`: `parent` | `child`
  - `ageGroup`: required for children (`child` | `teen` | `young_adult`)
  - `parentalVisibility`: optional, allow parents to see child transcripts
  - `telegramUserIds`: array of Telegram user IDs for this member
- `parentsGroup.telegramChatId`: optional, approved group chat id (Telegram group IDs can be **negative**)

## Environment overrides

- `HALO_HOME`: runtime root (default `~/.halo`)
- `GATEWAY_HOST`: override `gateway.host`
- `GATEWAY_PORT`: override `gateway.port`
- `LOG_DIR`: override the log directory for gateway and telegram runs
- `SQLITE_VEC_EXT`: sqlite-vec extension path for semantic memory
- `HALO_COMPACTION_ENABLED`: toggle compaction defaults in CLI/dev
- `HALO_DISTILLATION_ENABLED`: toggle distillation defaults in CLI/dev

## nodes.json (future)

Defines nodes and which member they belong to.

Fields:
- `schemaVersion`: number
- `nodes[]`: list of nodes

A node is a capability boundary for a member. Even when Core and the parent node run on the same machine, Core routes via the node abstraction.
