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

## 2c) Configure gateway config.json (required for `pnpm start:gateway`)

```bash
cp config/halo.example.json ~/.halo/config.json
# edit ~/.halo/config.json (gateway, features, memory, childSafe, semanticMemory)
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
- `OPENAI_API_KEY` is required for real model calls (smoke tests stub the model).

Gateway admin exposes:

- `GET /events/tail?lines=N` (loopback-only)
- `GET /transcripts/tail?scopeId=...&lines=N` (loopback-only)
- `POST /sessions/:scopeId/purge?confirm=:scopeId` (loopback-only)
