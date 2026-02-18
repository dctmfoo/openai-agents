# P2-01 — Onboarding domain + invite contract

- Status: `DONE`
- AssignedTo: `pi-tmux-delegate`
- StartedAt: `2026-02-17T23:10:00+05:30`
- CompletedAt: `2026-02-17T23:49:30+05:30`

Task:
- Define onboarding entities: household, invite, member-link, role/profile assignment.
- Define invite lifecycle: issued, accepted, expired, revoked.
- Define relink contract for changed Telegram accounts.
- Define DM vs group scope contract clearly (member DM, parents group, family group) for onboarding UX language.

Verification:
```bash
pnpm test
pnpm build
pnpm check:deadcode
```

VerificationResult: `PASS` (all three commands completed successfully on 2026-02-17).
