# Troubleshooting

## Missing env vars

- `Missing TELEGRAM_BOT_TOKEN in environment`: set `TELEGRAM_BOT_TOKEN` in your shell or `.env`.
- `OPENAI_API_KEY is required for OpenAI embeddings`: set `OPENAI_API_KEY` or disable semantic memory in `config.json`.

## Missing or invalid configs

- `Missing halo config at .../config.json`: run `pnpm halo:config:init` or copy `config/halo.example.json` manually.
- `Family config not found at .../config/family.json`: run `pnpm halo:config:init` or copy `config/family.example.json` manually.
- `Invalid JSON in ...`: fix trailing commas or malformed JSON in the referenced file.

## Semantic memory errors

- `sqlite-vec extension path missing`: set `SQLITE_VEC_EXT`, set `semanticMemory.vecExtensionPath`, or disable `semanticMemory.enabled` in `config.json`.
- `Embedding provider mismatch` or `Embedding dimensions mismatch`: delete `HALO_HOME/memory/scopes/<hash>/semantic.db` and retry.

## Telegram behavior surprises

- Unknown DMs get a short refusal and no session.
- Group chats are ignored unless the group ID matches `parentsGroup.telegramChatId`.
- Family config is loaded at startup. Restart after changing `family.json`.

## Shell tool errors

- `Tool 'shell' is not supported with gpt-4.1`: this model does not support the hosted shell tool.
  - Prime auto-selects `gpt-5.1` when shell is enabled.
  - Optional overrides:
    - `PRIME_MODEL` (global)
    - `PRIME_SHELL_MODEL` (only when shell is present)

## Restart command behavior

- `/restart` or `/br` exits the runtime with code `43` (parent DM only).
- To auto-build and come back up, run gateway under supervisor:
  - `pnpm dev:gateway:supervised`
  - or `make gateway-supervised`
- If you run plain `pnpm dev:gateway`, `/restart` will stop the process but will not auto-restart.

## Logs and diagnostics

- Structured event logs: `HALO_HOME/logs/events.jsonl`
- Runtime operational logs: `HALO_HOME/logs/runtime.jsonl`
- Local tail helper: `make logs`

Admin tail endpoints (loopback-only):

- `GET /events/tail?lines=N`
- `GET /transcripts/tail?scopeId=...&lines=N`

## Config validation

Run this if you are unsure about config shape:

```bash
pnpm halo:config:validate
```
