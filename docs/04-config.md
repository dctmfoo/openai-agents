# Configuration

This project currently uses **two** JSON files.

- `HALO_HOME/config.json` (gateway runtime settings, required for `pnpm start:gateway`)
- `HALO_HOME/config/family.json` (Telegram policy + `/policy/status`)

Examples:
- `config/halo.example.json`
- `config/family.example.json`

## Bootstrap

```bash
cp config/halo.example.json ~/.halo/config.json
mkdir -p ~/.halo/config
cp config/family.example.json ~/.halo/config/family.json
# edit both files
```

Notes:
- `TELEGRAM_BOT_TOKEN` stays in the environment (don't put secrets in config.json).
- Gateway host/port can be overridden via `GATEWAY_HOST` and `GATEWAY_PORT` env vars.
- Both files share the same `family` schema; `config.json` includes a `family` block but the bot still reads `config/family.json` today. Keep them in sync.

## Principles

- Keep configs small and explicit.
- Validate with Zod at startup.
- Version configs with `schemaVersion`.

## config.json structure

The unified config includes:

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
    "distillationMaxItems": 200
  },
  "family": { ... }
}
```

### gateway

- `host`: bind address (default `127.0.0.1`)
- `port`: bind port (default `8787`)

### features

- `compactionEnabled`: enable OpenAI Responses API compaction (default `false` in config file)
- `distillationEnabled`: enable deterministic memory distillation (default `false`)

Notes:
- When running via the gateway (`pnpm start:gateway`), the config file values are used.
- `HALO_COMPACTION_ENABLED` and `HALO_DISTILLATION_ENABLED` only affect SessionStore defaults when it is instantiated without explicit options (CLI/dev paths).
- SessionStore defaults also auto-enable compaction when `OPENAI_API_KEY` is set, unless you pass explicit options.

### memory

- `distillationEveryNItems`: trigger distillation after N transcript items (default `20`)
- `distillationMaxItems`: max items to consider when distilling (default `200`)

### family

Defines family members and the parents-only group (schema used by both `config.json` and `config/family.json`).

Fields:
- `schemaVersion`: number
- `familyId`: string
- `members[]`: list of members
  - `memberId`: stable identifier (e.g. `wags`)
  - `displayName`: human-readable name
  - `role`: `parent` | `child`
  - `telegramUserIds`: array of Telegram user IDs for this member
- `parentsGroup.telegramChatId`: optional, approved group chat id (Telegram group IDs can be **negative**)

## nodes.json (future)

Defines nodes and which member they belong to.

Fields:
- `schemaVersion`: number
- `nodes[]`: list of nodes

A node is a capability boundary for a member. Even when Core and the parent node run on the same machine, Core routes via the node abstraction.
