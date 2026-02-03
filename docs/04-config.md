# Configuration

This project is configured via a single JSON file.

- Example config is committed under `config/halo.example.json`.
- Real config lives at: `HALO_HOME/config.json` (defaults to `~/.halo/config.json`).

## Files

- `config/halo.example.json` → `HALO_HOME/config.json`

Notes:
- `TELEGRAM_BOT_TOKEN` stays in the environment (don’t put secrets in config.json).

## Principles

- Keep configs small and explicit.
- Validate with Zod at startup.
- Version configs with `schemaVersion`.

## family.json

Defines family members and the parents-only group.

Location:
- `HALO_HOME/config/family.json` (default: `~/.halo/config/family.json`)

Bootstrap:

```bash
mkdir -p ~/.halo/config
cp config/family.example.json ~/.halo/config/family.json
```

Fields:
- `schemaVersion`: number
- `familyId`: string
- `members[]`: list of members (role + Telegram user IDs)
- `parentsGroup.telegramChatId`: optional, approved group chat id (Telegram group IDs can be **negative**)

## nodes.json

Defines nodes and which member they belong to.

Fields:
- `schemaVersion`: number
- `nodes[]`: list of nodes

A node is a capability boundary for a member. Even when Core and the parent node run on the same machine, Core routes via the node abstraction.
