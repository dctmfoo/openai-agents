# Policies

This document defines the policy baseline for a family-first companion.

We implement policy as code (pure functions) and keep it easy to unit test.

## Roles

- `parent`
- `child`

## Scopes

- `dm`
- `parents_group`

## Default rules (high level)

1) Unknown users are not allowed.
- Unknown DM → refuse + ask to be invited by a parent.

2) Parents-only group must contain only parents.
- If a child is present, do not approve/enable the group.

3) Privacy boundaries
- DM memory is private to that member.
- Parents-group memory is shared among parents.
- No automatic DM → parents-group promotion.

## Action matrix (v1)

Legend: ✅ allow, ❌ deny

### Messaging
- parent in dm: ✅
- child in dm: ✅
- parent in parents_group: ✅
- child in parents_group: ❌ (group should not include children)

### Memory writeback (files)
- parent in dm: ✅ (private)
- child in dm: ✅ (private)
- parent in parents_group: ✅ (shared among parents)
- child in parents_group: ❌

### Tool execution (future)
Default stance: deny-by-default; allow only explicitly.

- child tools: deny unless specifically safe/read-only
- parent tools: allowed only via explicit allowlist (node boundary planned)

## Adapter enforcement

The Telegram adapter loads family config from `HALO_HOME/config/family.json` and caches it for the life of the process (restart to pick up changes). The admin `/policy/status` endpoint reads the same file. The embedded `family` block in `config.json` is validated for gateway startup, but it is not used for policy decisions yet.

- Unknown DMs receive a short refusal message ("Hi! This bot is private to our family. Please ask a parent to invite you.") and **do not create a session**.
- Non-private chats (groups) are ignored unless `parentsGroup.telegramChatId` matches the chat id and the sender is a known member.
- Children in the approved parents-group are silently denied (no reply).

### Scope ID format

Scope IDs are deterministic strings used to isolate sessions and memory:
- DM scope: `telegram:dm:<memberId>` (e.g., `telegram:dm:wags`)
- Parents group scope: `telegram:parents_group:<chatId>` (e.g., `telegram:parents_group:-123456789`)

These scope IDs are hashed (SHA256) to derive file paths for sessions, transcripts, and scoped memory.

## Transcripts and clear/purge semantics

- Transcripts are append-only JSONL under `HALO_HOME/transcripts`.
- Derived session state (summaries/compactions) is stored separately under `HALO_HOME/sessions`.
- Admin **Clear** clears only derived session state (keeps transcript history).
- Admin **Purge** deletes both derived session state and transcripts (loopback-only + confirmation required).
