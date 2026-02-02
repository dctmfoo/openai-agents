# Ralph prompt template (Codex)

This prompt is used by `scripts/ralph/ralph.sh`.

## Rules (critical)
- Implement *only* the selected story.
- Keep changes small and test-driven.
- Do **not** create or switch git branches.
- Do **not** run `git commit`.
- Do **not** edit `prd.json`, `progress.txt`, `tasks/`, `reports/`, or `archive/`.

The loop runner (bash script) will:
- run `pnpm test && pnpm build`
- commit changes
- update `prd.json` + `progress.txt`
