# openai-agents

A doot-style **personal agent framework** built on the **OpenAI Agents SDK (TypeScript)**.

Goal: a single “Prime” agent that talks to you (CLI first), delegates to specialist sub-agents (least privilege), writes to file-based memory, and stays safe via verification/approval layers.

## Status

Phase 0 (docs + plan) in progress.

## Docs

- [Vision](docs/00-vision.md)
- [Scope (v1)](docs/01-scope.md)
- [Telegram setup (halo)](docs/02-telegram-setup.md)

## Principles (porting from doot)

- Gather → Act → Verify
- Least privilege tools (allowlist)
- File system as context (hot/warm memory)
- Evals as quality gates (regression + capability)

## License

TBD
