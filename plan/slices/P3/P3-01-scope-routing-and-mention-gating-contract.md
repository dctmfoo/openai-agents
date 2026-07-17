# P3-01 — Scope routing + mention gating contract

- Status: `DONE`
- AssignedTo: `pi-tmux-delegate`
- StartedAt: `2026-02-17T23:55:00+05:30`
- CompletedBy: `pi`
- CompletedAt: `2026-02-18T00:00:12+05:30`

Task:
- Define family-group/parents-group/DM routing semantics.
- Define mention-required behavior and exceptions.

Verification:
```bash
pnpm test
pnpm build
pnpm check:deadcode
```

ScenarioEvidence:
- Scope routing is now explicit and deterministic for Telegram surfaces:
  - `private` chats route to `dm`.
  - configured `parents_group` chat id routes to `parents_group`.
  - configured `family_group` chat id routes to `family_group`.
  - all other non-DM chats are denied as `group_not_approved`.
- Family-group mention gating is explicit with a documented no-exception contract:
  - missing mention denies with rationale `mention_required_in_family_group` and `family_group_mention_exceptions_none`.
  - command text alone does not bypass mention gating.
- Determinism is asserted: identical inputs produce identical decision envelopes.

VerificationEvidence:
- `pnpm test` ✅ (`50` files, `297` tests passed)
- `pnpm build` ✅
- `pnpm check:deadcode` ✅ (passes; existing knip configuration hints only)
