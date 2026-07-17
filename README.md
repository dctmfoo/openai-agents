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

Create your configs (recommended):

```bash
pnpm halo:config:init
```

Or copy manually:

```bash
cp config/halo.example.json ~/.halo/config.json
mkdir -p ~/.halo/config
cp config/family.example.json ~/.halo/config/family.json
# edit both files
```

`config.json` is used by the gateway runtime. Telegram policy reads `config/family.json`.

`config.json` includes:
- `gateway`: host/port for admin server (default `127.0.0.1:8787`)
- `features`: `compactionEnabled`, `distillationEnabled`
- `memory`: `distillationEveryNItems`, `distillationMaxItems`
- `childSafe`: child guardrails (length, topics)
- `semanticMemory`: embeddings + sqlite-vec settings
- `fileMemory`: OpenAI vector-store upload + hosted file-search controls

Validate configs (optional):

```bash
pnpm halo:config:validate
```

### 3) Choose a run path

1. CLI (fast local check)

```bash
OPENAI_API_KEY=... pnpm dev:cli "Hello Prime"
```

2. Telegram (local bot)

```bash
TELEGRAM_BOT_TOKEN=... pnpm dev:telegram
```

3. Gateway + Admin (recommended for full stack)

```bash
pnpm build
TELEGRAM_BOT_TOKEN=... pnpm start:gateway
```

Gateway defaults to: `http://127.0.0.1:8787`

For local supervised dev (supports Telegram `/restart` to trigger build+restart):

```bash
TELEGRAM_BOT_TOKEN=... pnpm dev:gateway:supervised
```

Run the Admin Console (Tauri v2):

```bash
cd apps/admin
pnpm install
pnpm tauri:dev
```

### 4) Smoke test (optional)

```bash
pnpm smoke:e2e
```

## Behavior (today)

- **Unknown DMs are refused** (short message, no session created).
- **Group chats are ignored** unless the group is explicitly approved as the **parents group** in config.
- **Children in parents group are denied** (child role cannot message in parents_group scope).
- **Transcripts are append-only** under `HALO_HOME/transcripts/<hash>.jsonl`.
- **Derived session state** (summaries/compactions) lives under `HALO_HOME/sessions/<hash>.jsonl`.
- **Scoped memory** (distilled facts, daily notes) under `HALO_HOME/memory/scopes/<hash>/`.
- **Scoped file memory (phase 3 shipped)** for Telegram `message:document` uploads under `HALO_HOME/file-memory/scopes/<hash>/` (OpenAI vector stores + hosted `file_search`) with retention cleanup, dry-run, guardrails, policy presets, and metadata-filtered manual retention runs.

Scope IDs follow the pattern `telegram:dm:<memberId>` or `telegram:parents_group:<chatId>`.

## Docs

Active foundation:
- [Policy + Control Plane Blueprint (v2 foundation)](docs/18-policy-control-plane-blueprint.md)
- [Family Architecture Discussion (in progress)](docs/17-family-architecture-discussion-in-progress.md)

Legacy docs:
- [Archive index](docs/archive/README.md)

## License

TBD
