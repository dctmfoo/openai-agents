# Telegram setup (halo)

This project runs a Telegram bot for **private chats only**.

## 1) Create a bot

- Talk to @BotFather
- Create a bot, copy the token

## 2) Configure environment

Copy `.env.example` to `.env` (or export env vars) with:

```bash
TELEGRAM_BOT_TOKEN=...
HALO_HOME=...
OPENAI_API_KEY=...
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

- Logs are written to `logs/events.jsonl` (gitignored).
- Group chats are ignored.
- `OPENAI_API_KEY` is optional if you authenticate via Codex device OAuth.
