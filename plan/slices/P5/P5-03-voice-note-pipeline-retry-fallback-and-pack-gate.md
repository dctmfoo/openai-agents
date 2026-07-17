# P5-03 — Voice-note pipeline retry/fallback + Pack 5 gate

- Status: `DONE`

Task:
- Add voice-note ingestion path (Telegram) with transcription retries.
- On repeated failure, provide clear fallback prompt to user.
- Close Pack 5 with multimodal + retrieval safety evidence.

Verification:
```bash
pnpm test
pnpm build
pnpm check:deadcode
pnpm check:complexity
```

Completion evidence:
- Focused RED→GREEN loops:
  - `pnpm vitest run src/interfaces/telegram/bot.test.ts` (RED then GREEN for voice-note tests)
  - `pnpm vitest run src/interfaces/telegram/bot.test.ts src/interfaces/telegram/policy.test.ts` ✅
- Slice gate:
  - `pnpm test` ✅
  - `pnpm build` ✅
  - `pnpm check:deadcode` ✅
  - `pnpm check:complexity` ✅ (warnings only, no errors)
