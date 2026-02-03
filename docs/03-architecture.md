# Architecture (Family-first Companion)

This repo implements a **family-first AI companion** built with the **OpenAI Agents SDK (TypeScript)**.

Design priorities:
- **Family-first**: multiple humans, clear privacy boundaries.
- **Telegram-first**: private DMs + parents-only group.
- **SDK-patterns-first**: Sessions, compaction, tools, guardrails.
- **Portability**: treat “core” as an orchestrator; all actions/data flow via a Node abstraction.

## 1) Core concepts

### Member
A human in the family.

- `memberId`: stable identifier (e.g. `wags`, `mom`, `aarav`)
- `role`: `parent` | `child`

### Scope
A conversation context (a chat thread) with its own session and policy.

- `scopeId`: stable per chat (Telegram chat id)
- `scopeType`: `dm` | `parents_group` | (future: `family_group`, `subgroup`)

### Speaker vs Target
For every incoming message:
- **speaker**: who wrote the message (Telegram `from.id` → member)
- **scope**: where it was written (Telegram `chat.id` → scope)
- **target**: who the request is about (defaults to speaker; may be overridden by explicit intent)

### Node
A Node represents a **device/account boundary** that owns data and executes actions for a member.

- A member can have 0..n nodes.
- Even if Core runs on a parent’s computer, it still calls the **local parent node** through the Node interface.

This keeps the system portable (export/import, re-hosting, custody/ownership changes) and enforces data boundaries by construction.

## 2) Supported conversation scopes

### 2.1 Direct messages (DM)
- One member ↔ halo.
- Session and memory are **private** to that member by default.

### 2.2 Parents-only group (default group mode)
- A Telegram group chat containing only parents + halo.
- All messages in this scope are visible to all parents.

Decisions:
- Child accounts **must not** be in this group.
- If a child is present, the group must not be configured/approved.

## 3) Identity, onboarding, and trust

### 3.1 Unknown user DMs
Decision:
- If an unknown Telegram user DMs halo, halo **does not engage** beyond a short message and asks them to contact a parent to be invited.

### 3.2 Approving a parents-only group
Group chats are **untrusted by default**.

A parents-only group becomes active only after:
- a parent approves it, and
- the system verifies the group has no child members.

## 4) Data model (high level)

We separate:

1) **Conversation state** (for continuing a chat)
- Stored via Agents SDK **Sessions**.
- Compacted via `/responses/compact` (through `OpenAIResponsesCompactionSession`) when using Responses models.

2) **Memory files** (for human-readable long-term and temporal notes)
- Stored as markdown on disk.
- Not committed to git.
- Updated by a memory distillation process.

3) **Logs / audit**
- Append-only logs for debugging and safety.

## 5) Conversation state (Agents SDK)

We will use:
- `MemorySession` (local session persistence abstraction to start)
- `OpenAIResponsesCompactionSession` to keep long-running sessions small

Notes:
- Raw transcripts are append-only JSONL files under `HALO_HOME/transcripts` (source of truth).
- Derived session state (summaries/compactions) is stored separately under `HALO_HOME/sessions`.
- Compaction keeps user messages verbatim and replaces prior assistant/tool items with an encrypted compaction item.

## 6) Memory distillation (lasting vs temporal)

We keep memory files separate from session state.

### Default privacy rule
Decision:
- DM facts stay private to that member.
- Parents-group facts are shared among parents.
- No automatic promotion from DM → parents-group. Sharing must be explicit.

Distillation outputs:
- **lasting facts** (stable preferences, relationships, recurring routines)
- **temporal facts** (today’s status, short-lived plans)

Distillation triggers (planned):
- on compaction, and/or
- on idle, and/or
- manual admin command

## 6a) Admin UI (Tauri)

- The desktop admin app reads gateway status via `GET /status`.
- Default gateway base is `http://127.0.0.1:8787` (override with `?gateway=` in the admin URL).
- Session inventory:
`GET /sessions` returns scope id strings (legacy shape).
`GET /sessions-with-counts` returns `{ scopeId, itemCount }` objects.

## 7) Security boundaries (summary)

- Treat all chat text as untrusted input.
- Enforce permissions outside prompts (policy-as-code).
- Nodes are strict boundaries: tools must be scoped to the target member’s node.
- Avoid storing secrets in plaintext memory; redact obvious tokens.

## 8) Portability / transfer

We plan for:
- exporting a family workspace (configs + memory files + audit logs)
- re-attaching nodes to a new core
- revoking a node

We will keep this manual-first (explicit export/import) until later.

## 9) Testing strategy

- TDD by default.
- Deterministic unit tests for:
  - config validation
  - scope/member resolution
  - memory distillation routing rules
  - policy decisions (allow/deny)
- Behavioral evals later for tone and memory quality.
