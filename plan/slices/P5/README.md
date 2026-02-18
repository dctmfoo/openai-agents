# Pack 5 — Retrieval, file search, and voice notes

Functional outcome:
- retrieval and file search are lane-prefiltered,
- citation leaks are blocked,
- voice notes follow transcribe→policy path with retry/fallback.

Execution order:
1. `P5-01-retrieval-prefilter-and-ranking-hooks.md`
2. `P5-02-file-search-lane-guard-and-citation-policy.md`
3. `P5-03-voice-note-pipeline-retry-fallback-and-pack-gate.md`

Pack gate commands:
```bash
pnpm test
pnpm build
pnpm check:deadcode
```
