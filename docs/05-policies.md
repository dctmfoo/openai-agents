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
- parent tools: allowed only via node boundary + explicit allowlist

## Adapter enforcement

The Telegram adapter checks `family.json` on each message.

- Unknown DMs receive a short refusal message and **do not create a session**.
- Group messages are processed only when `parentsGroup.telegramChatId` matches the chat id.

## Transcripts and clear/purge semantics

- Transcripts are append-only JSONL under `HALO_HOME/transcripts`.
- Derived session state (summaries/compactions) is stored separately under `HALO_HOME/sessions`.
- Admin **Clear** clears only derived session state (keeps transcript history).
- Admin **Purge** deletes both derived session state and transcripts (loopback-only + confirmation required).
