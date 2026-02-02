# Configuration

This project is configured via local JSON files.

- Example configs are committed under `config/*.example.json`.
- Real configs live under `config/*.json` and are **gitignored**.

## Files

- `config/family.example.json` → `config/family.json`
- `config/nodes.example.json` → `config/nodes.json`

## Principles

- Keep configs small and explicit.
- Validate with Zod at startup.
- Version configs with `schemaVersion`.

## family.json

Defines family members and the parents-only group.

Fields:
- `schemaVersion`: number
- `familyId`: string
- `members[]`: list of members (role + Telegram user IDs)
- `parentsGroup`: optional, approved group chat id

## nodes.json

Defines nodes and which member they belong to.

Fields:
- `schemaVersion`: number
- `nodes[]`: list of nodes

A node is a capability boundary for a member. Even when Core and the parent node run on the same machine, Core routes via the node abstraction.
