# Telegram setup (halo)

This project runs a Telegram bot for **private chats only**.

## 1) Create a bot

- Talk to @BotFather
- Create a bot, copy the token

## 2) Configure environment

Create `.env` (or export env vars) with:

```bash
OPENAI_API_KEY=...
TELEGRAM_BOT_TOKEN=...
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
