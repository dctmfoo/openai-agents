# Telegram setup (halo)

This project runs a Telegram bot for **private chats**, plus an optional **approved parents-only group**.

## 1) Create a bot

- Talk to @BotFather
- Create a bot, copy the token

## 2) Configure environment

Copy `.env.example` to `.env` (or export env vars) with:

```bash
TELEGRAM_BOT_TOKEN=...
# optional (defaults to ~/.halo)
HALO_HOME=...
OPENAI_API_KEY=...
```

## 2a) Initialize configs (recommended)

```bash
pnpm halo:config:init
```

## 2b) Configure family policy (required)

Telegram policy is loaded from `HALO_HOME/config/family.json` and cached at startup.

```bash
mkdir -p ~/.halo/config
cp config/family.example.json ~/.halo/config/family.json
# edit ~/.halo/config/family.json
```

Notes:
- `members[].telegramUserIds` are **Telegram user IDs** (positive integers).
- `parentsGroup.telegramChatId` is the **approved group chat id**. Telegram group IDs can be **negative**.

## 2c) Configure gateway config.json (required for `pnpm dev:telegram` and `pnpm start:gateway`)

```bash
cp config/halo.example.json ~/.halo/config.json
# edit ~/.halo/config.json (gateway, features, memory, childSafe, semanticMemory, fileMemory)
```

## 3) Run locally

```bash
pnpm install
pnpm dev:telegram
```

You should see `halo (telegram) starting…`.

To run via the gateway runtime after building:

```bash
pnpm build
pnpm start:gateway
```

## Notes

- `dev:telegram` writes logs to `HALO_HOME/logs/events.jsonl` by default (override with `LOG_DIR`).
- `start:gateway` writes logs to `HALO_HOME/logs/events.jsonl` by default.
- Scoped memory is written under `HALO_HOME/memory/scopes/<hash>/`.
- Unknown DMs are refused (and do not create a session).
- Group chats are ignored unless the group matches `parentsGroup.telegramChatId` and the sender is in the family list.
- Family config is loaded once at startup; restart to pick up changes.
- Parent DMs support `/restart` (and `/br`) to request build+restart. This works when running with the supervisor (`pnpm dev:gateway:supervised` or `make gateway-supervised`).
- `OPENAI_API_KEY` is required for real model calls (smoke tests stub the model).
- Semantic memory background sync is built-in for active scopes when `semanticMemory.enabled=true`; cadence is `semanticMemory.syncIntervalMinutes`.
- Telegram image messages are routed to direct vision analysis (`message:photo` and image `message:document` with `mime_type=image/*`).
- Non-image `message:document` uploads are enabled only when `fileMemory.enabled=true` and `fileMemory.uploadEnabled=true`.
- During upload flow, users receive stage updates (download started, indexing started, final success/failure).
- Upload/vision telemetry is also written as structured `file.upload` events in `events.jsonl`.
- Optional retention cleanup can be enabled via `fileMemory.retention.enabled=true` in `HALO_HOME/config.json` (with optional `policyPreset`, `allowScopeIds`, and `denyScopeIds` controls; role-based presets use `family.json` member roles).

Gateway admin exposes:

- `GET /events/tail?lines=N` (loopback-only)
- `GET /transcripts/tail?scopeId=...&lines=N` (loopback-only)
- `GET /sessions/:scopeId/files` (when `fileMemory.enabled=true`)
- `POST /sessions/:scopeId/files/:fileRef/delete?deleteOpenAIFile=0|1` (loopback-only)
- `POST /sessions/:scopeId/files/purge?deleteOpenAIFiles=0|1` (loopback-only)
- `POST /file-retention/run?scopeId=...&dryRun=0|1&uploadedBy=...&extensions=...&mimePrefixes=...&uploadedAfterMs=...&uploadedBeforeMs=...` (loopback-only)
- `POST /sessions/:scopeId/purge?confirm=:scopeId` (loopback-only)
