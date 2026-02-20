# Onboarding (First Run)

> Last updated: 2026-02-19

This guide gets you from zero to a working local run in under 15 minutes.

## Prerequisites

- Node.js (see `package.json` engines or your team standard)
- pnpm (required by the repo)
- Telegram bot token for Telegram or Gateway runs
- OpenAI API key for real model calls
- sqlite-vec extension path if semantic memory is enabled

---

## v2 Setup Path (Recommended)

### 1) Install dependencies

```bash
pnpm install
```

### 2) Initialize configs

```bash
# Copy the v2 control plane template
cp config/control-plane.example.json ~/.halo/config/control-plane.json

# Copy the gateway config
cp config/halo.example.json ~/.halo/config.json

mkdir -p ~/.halo/config
```

Edit `~/.halo/config/control-plane.json`:
- Set `familyId` to a stable household identifier
- Replace `telegramUserIds` in `members[]` with real Telegram user IDs
- Set `telegramChatId` in the `parents_group` scope (negative integer for Telegram groups), or leave `null` if not using a group
- Set `telegramChatId` in the `family_group` scope if using a whole-family group

Edit `~/.halo/config.json`:
- Ensure the `controlPlane` block points to your control plane file:

```json
{
  "controlPlane": {
    "activeProfile": "v2",
    "profiles": {
      "v2": { "path": "config/control-plane.json" }
    }
  }
}
```

### 3) Set environment

```bash
export TELEGRAM_BOT_TOKEN=...
export OPENAI_API_KEY=...
# optional
export HALO_HOME=~/.halo
export SQLITE_VEC_EXT=...
```

`HALO_HOME` defaults to `~/.halo` if not set.

### 4) Choose a run path

**CLI** (fast local check)

```bash
pnpm dev:cli "Hello Prime"
```

**Telegram** (local bot)

```bash
pnpm dev:telegram
```

**Gateway + Admin** (full stack)

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

### 5) Validate configs (optional)

```bash
pnpm halo:config:validate
```

### 6) Expected outputs

- CLI prints a response to stdout.
- Telegram shows `halo (telegram) starting…` in logs and replies in DM.
- Gateway shows `halo (gateway) starting…` and serves `http://127.0.0.1:8787`.

---

## v2 Onboarding via Telegram `/onboard` Commands

After the bot is running, parents can onboard family members directly from Telegram DMs.

**All `/onboard` commands must be sent as DMs from a known parent.**

### `/onboard bootstrap`

Initializes the onboarding contract for the household. The first parent to run this becomes the household owner.

```
/onboard bootstrap
```

Run once per household. Safe to re-run — returns `already_bootstrapped` if already initialized.

### `/onboard join <role> <memberId> <displayName> <telegramUserId> [ageGroup] [parentalVisibility]`

Adds a family member to the household. Bootstraps the contract if needed.

```
/onboard join parent alice "Alice Smith" 123456789
/onboard join spouse bob "Bob Smith" 987654321
/onboard join child kairav "Kairav" 111111111 child true
/onboard join child manasa "Manasa" 222222222 teen false
```

Parameters:
- `role`: `parent` | `spouse` | `child` (spouse maps to `parent` role internally)
- `memberId`: stable identifier (no spaces, e.g. `wags`, `kairav`)
- `displayName`: human-readable name (quote if it contains spaces)
- `telegramUserId`: the member's Telegram user ID (positive integer)
- `ageGroup` (child only): `child` | `teen` | `young_adult`
- `parentalVisibility` (child only): `true` | `false` — whether parents can see this child's transcripts

### `/onboard help`

Shows usage summary.

---

## Onboarding contract schema

The onboarding contract is stored in the `onboarding` field of the config file. It tracks:

```json
{
  "household": {
    "householdId": "household-default",
    "displayName": "default household",
    "ownerMemberId": "wags",
    "createdAt": "2026-02-19T00:00:00.000Z"
  },
  "memberLinks": [
    {
      "memberId": "wags",
      "role": "parent",
      "profileId": "parent_default",
      "telegramUserId": 889348242,
      "linkedAt": "2026-02-19T00:00:00.000Z",
      "linkedByMemberId": "wags"
    }
  ],
  "invites": [],
  "relinks": []
}
```

Fields:
- `household`: who created the household and when
- `memberLinks[]`: every successful join event with Telegram user ID, role, and profile
- `invites[]`: issued/accepted/revoked invites (audit trail)
- `relinks[]`: Telegram user ID reassignments for existing members

---

## v1 Setup Path (Legacy)

If you are not using the v2 control plane, the v1 `family.json` path still works.

```bash
cp config/halo.example.json ~/.halo/config.json
mkdir -p ~/.halo/config
cp config/family.example.json ~/.halo/config/family.json
# edit both files
```

Set `controlPlane.activeProfile` to `"legacy"` in `config.json`, or omit the `controlPlane` block entirely (defaults to `config/family.json`).

Edit `family.json` to match your family and bot IDs:

```json
{
  "schemaVersion": 1,
  "familyId": "my-family",
  "members": [
    {
      "memberId": "alice",
      "displayName": "Alice",
      "role": "parent",
      "telegramUserIds": [123456789]
    }
  ],
  "parentsGroup": { "telegramChatId": -100123456789 }
}
```

---

## Where files go

All durable state lives under `HALO_HOME` (default `~/.halo`).

- `HALO_HOME/config.json` — gateway runtime settings
- `HALO_HOME/config/control-plane.json` — v2 control plane (primary)
- `HALO_HOME/config/family.json` — v1 legacy config
- `HALO_HOME/logs/events.jsonl`
- `HALO_HOME/transcripts/<hash>.jsonl`
- `HALO_HOME/sessions/<hash>.jsonl`
- `HALO_HOME/memory/lanes/<laneId>/` — lane memory files (v2)

If you want Prime to load the repo defaults for personality/context, copy `SOUL.md` and `USER.md` into `HALO_HOME` or set `HALO_HOME` to the repo root.
