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

## 2a) Configure family policy (required)

Halo reads the family allowlist from:

- `HALO_HOME/config/family.json` (default: `~/.halo/config/family.json`)

Start by copying the example:

```bash
mkdir -p ~/.halo/config
cp config/family.example.json ~/.halo/config/family.json
# edit ~/.halo/config/family.json
```

Notes:
- `members[].telegramUserIds` are **Telegram user IDs** (positive integers).
- `parentsGroup.telegramChatId` is the **approved group chat id**. Telegram group IDs can be **negative**.

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

- Logs are written to `~/.halo/logs/events.jsonl` by default (gitignored).
- Unknown DMs are refused (and do not create a session).
- Group chats are ignored unless the group matches `parentsGroup.telegramChatId`.
- `OPENAI_API_KEY` is optional if you authenticate via Codex device OAuth.
- Gateway admin exposes:
  - `GET /events/tail?lines=N` (loopback-only)
  - `GET /transcripts/tail?scopeId=...&lines=N` (loopback-only)
  - `POST /sessions/:scopeId/purge?confirm=:scopeId` (loopback-only)
