# Phase 3 Implementation Plan — Error Handling and Developer UX

## Current Patterns Observed

### Startup entrypoints
- `src/gateway/start.ts` and `src/interfaces/telegram/start.ts` validate `TELEGRAM_BOT_TOKEN` and throw on missing values.
- `src/interfaces/cli/run.ts` prints a usage message and exits for missing input, then runs without a try/catch.
- None of the three entrypoints wrap startup in a consistent try/catch or print actionable next steps (stack traces are default).
- Log paths (events, transcripts, sessions, memory) are not surfaced when errors happen.

### Tool error handling
- `src/tools/semanticSearchTool.ts` returns `[]` when semantic memory is disabled or config is missing/invalid.
- The tool throws for missing `rootDir/scopeId` and can still throw on runtime failures from `SemanticMemory` (for example missing `SQLITE_VEC_EXT` inside `VectorStore.open`).

### Config loading
- `src/runtime/haloConfig.ts` throws on missing/invalid config with a clear message and path.
- It applies env overrides (gateway host/port and vec extension path resolution).

## Implementation Steps

### 1) Add a `pnpm doctor` preflight command
- Create `src/dev/doctor.ts`.
- Checks:
  - Required env vars for typical runs:
    - `OPENAI_API_KEY` (required for model calls)
    - `TELEGRAM_BOT_TOKEN` (required for `dev:telegram` and gateway Telegram adapter)
  - Config files:
    - `HALO_HOME/config.json` via `loadHaloConfig`
    - `HALO_HOME/config/family.json` via `loadFamilyConfig`
  - Semantic memory prerequisites when enabled:
    - Ensure a resolved `vecExtensionPath` (from config or `SQLITE_VEC_EXT`).
    - Verify the file exists on disk.
  - Filesystem write permissions for `HALO_HOME`:
    - Ensure the directory exists or can be created.
    - Check write access with `fs.access(..., W_OK)`.
- Output a checklist with `OK` / `WARN` / `FAIL` statuses and actionable hints.
- Exit with non-zero status when there are hard failures.
- Add a package script: `"doctor": "tsx src/dev/doctor.ts"`.

### 2) Improve runtime error messaging in startup entrypoints
- Add a small helper (new file) for consistent startup error reporting, e.g. `src/runtime/startupErrors.ts`.
- Wrap `src/gateway/start.ts`, `src/interfaces/telegram/start.ts`, and `src/interfaces/cli/run.ts` in `try/catch` blocks.
- On errors, print:
  - Error message (human-readable)
  - The most relevant file path (config or env, when detectable)
  - Next action (e.g., run `pnpm doctor`, set env var, or create configs)
  - Log locations:
    - `HALO_HOME/logs/events.jsonl`
    - `HALO_HOME/transcripts`
    - `HALO_HOME/sessions`
    - `HALO_HOME/memory`
- Preserve existing usage check for CLI input, but ensure unexpected failures go through the shared error reporter.

### 3) Make tool errors user-friendly
- Update `src/tools/semanticSearchTool.ts` to return a structured error object for expected failures (missing vec extension, disabled semantic memory, invalid config), instead of throwing.
- Keep programming errors (missing `rootDir/scopeId`) as hard errors.
- Update tests in `src/tools/semanticSearch.test.ts` to reflect new error shape or status reporting.
- Ensure the tool still returns normal results when semantic search works.

## Validation
- Run `pnpm test` (or at minimum `pnpm test src/tools/semanticSearch.test.ts`) to confirm semantic search behavior.
- Manually run `pnpm doctor` to verify output formatting and exit codes.

