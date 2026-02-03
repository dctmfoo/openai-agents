# openai-agents

A **Telegram-first, family-first personal companion** built with the **OpenAI Agents SDK (TypeScript)**.

Bot name: **halo**. Core agent: **Prime**.

## Quickstart

### 1) Install

```bash
pnpm install
```

### 2) Configure runtime state (HALO_HOME)

Halo keeps durable state (configs, sessions, transcripts, logs) under **HALO_HOME**.

- Default: `~/.halo`
- Override: `HALO_HOME=/path/to/dir`

Create your family config:

```bash
mkdir -p ~/.halo/config
cp config/family.example.json ~/.halo/config/family.json
# edit ~/.halo/config/family.json
```

### 3) Run the gateway (recommended)

```bash
pnpm build
TELEGRAM_BOT_TOKEN=... pnpm start:gateway
```

Gateway defaults to: `http://127.0.0.1:8787`

### 4) Run the Admin Console (Tauri v2)

```bash
cd apps/admin
pnpm install
pnpm tauri:dev
```

## Behavior (today)

- **Unknown DMs are refused** (no session created).
- **Group chats are ignored** unless the group is explicitly approved as the **parents group** in `family.json`.
- **Transcripts are append-only** under `HALO_HOME/transcripts`.
- **Derived session state** (summaries/compactions) lives under `HALO_HOME/sessions`.

## Docs

- [Vision](docs/00-vision.md)
- [Scope (v1)](docs/01-scope.md)
- [Telegram setup (halo)](docs/02-telegram-setup.md)
- [Configuration](docs/04-config.md)
- [Policies](docs/05-policies.md)

## License

TBD
