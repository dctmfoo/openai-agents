# Smoke tests

We keep a fast, local end-to-end smoke test to catch wiring regressions across:
- gateway admin server
- telegram adapter
- sessions/transcripts
- scoped memory + distillation

## Run

```bash
pnpm smoke:e2e
# or
./scripts/smoke-e2e.sh
```

Expected output:
- prints `SMOKE_E2E_OK`
- prints the temporary HALO_HOME used for the run

## Notes

- The smoke test uses a **fake Telegram bot** (no network calls).
- Prime is stubbed to avoid model calls; it still appends a user item into the configured SessionStore so transcripts + distillation are exercised.
