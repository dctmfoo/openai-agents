# Onboarding (First Run)

This guide gets you from zero to a working local run in under 15 minutes.

## Prerequisites

- Node.js (see `package.json` engines or your team standard)
- pnpm (required by the repo)
- Telegram bot token for Telegram or Gateway runs
- OpenAI API key for real model calls
- sqlite-vec extension path if semantic memory is enabled

## 1) Install dependencies

```bash
pnpm install
```

## 2) Initialize configs

Recommended:

```bash
pnpm halo:config:init
```

Manual:

```bash
cp config/halo.example.json ~/.halo/config.json
mkdir -p ~/.halo/config
cp config/family.example.json ~/.halo/config/family.json
```

Edit both files to match your family and bot IDs.

If you want Prime to load the repo defaults, copy `SOUL.md` and `USER.md` into `HALO_HOME` or set `HALO_HOME` to the repo root.

## 3) Set environment

```bash
TELEGRAM_BOT_TOKEN=...
OPENAI_API_KEY=...
# optional
HALO_HOME=...
SQLITE_VEC_EXT=...
```

`HALO_HOME` defaults to `~/.halo` if not set.

## 4) Choose a run path

1. CLI (fast local check)

```bash
pnpm dev:cli "Hello Prime"
```

2. Telegram (local bot)

```bash
pnpm dev:telegram
```

3. Gateway + Admin (full stack)

```bash
pnpm build
pnpm start:gateway
```

Then in a new terminal:

```bash
cd apps/admin
pnpm install
pnpm tauri:dev
```

## 5) Validate configs (optional)

```bash
pnpm halo:config:validate
```

## 6) Expected outputs

- CLI prints a response to stdout.
- Telegram shows `halo (telegram) starting…` in logs and replies in DM.
- Gateway shows `halo (gateway) starting…` and serves `http://127.0.0.1:8787`.

## Where files go

All durable state lives under `HALO_HOME` (default `~/.halo`).

- `HALO_HOME/config.json`
- `HALO_HOME/config/family.json`
- `HALO_HOME/logs/events.jsonl`
- `HALO_HOME/transcripts/<hash>.jsonl`
- `HALO_HOME/sessions/<hash>.jsonl`
- `HALO_HOME/memory/scopes/<hash>/`
