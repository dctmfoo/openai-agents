# openai-agents

A **Telegram-first, family-first personal companion** built with the **OpenAI Agents SDK (TypeScript)**.

Bot name: **halo**. Core agent: **Prime**.

## Quickstart

### 1) Install

```bash
pnpm install
```

### 2) Configure runtime state (HALO_HOME)

Halo keeps durable state (configs, sessions, transcripts, logs, memory) under **HALO_HOME**.

- Default: `~/.halo`
- Override: `HALO_HOME=/path/to/dir`

Create your configs:

```bash
cp config/halo.example.json ~/.halo/config.json
mkdir -p ~/.halo/config
cp config/family.example.json ~/.halo/config/family.json
# edit both files (keep the family blocks in sync)
```

`config.json` is used by the gateway runtime. The Telegram policy currently reads `config/family.json` (the embedded `family` block in `config.json` is validated but not used for policy yet).

`config.json` includes:
- `gateway`: host/port for admin server (default `127.0.0.1:8787`)
- `features`: `compactionEnabled`, `distillationEnabled`
- `memory`: `distillationEveryNItems`, `distillationMaxItems`
- `family`: members, roles, telegram user IDs, parents group

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

- **Unknown DMs are refused** (short message, no session created).
- **Group chats are ignored** unless the group is explicitly approved as the **parents group** in config.
- **Children in parents group are denied** (child role cannot message in parents_group scope).
- **Transcripts are append-only** under `HALO_HOME/transcripts/<hash>.jsonl`.
- **Derived session state** (summaries/compactions) lives under `HALO_HOME/sessions/<hash>.jsonl`.
- **Scoped memory** (distilled facts, daily notes) under `HALO_HOME/memory/scopes/<hash>/`.

Scope IDs follow the pattern `telegram:dm:<memberId>` or `telegram:parents_group:<chatId>`.

## Docs

- [Vision](docs/00-vision.md)
- [Scope (v1)](docs/01-scope.md)
- [Telegram setup (halo)](docs/02-telegram-setup.md)
- [Architecture](docs/03-architecture.md)
- [Configuration](docs/04-config.md)
- [Policies](docs/05-policies.md)
- [Smoke tests](docs/10-smoke-tests.md)

## License

TBD
