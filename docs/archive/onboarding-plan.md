# Developer Onboarding Improvement Plan

This plan documents the current onboarding experience and proposes a set of improvements focused on clarity, consistency, and fast time-to-first-success. It is scoped to docs, config, startup flow, tool registration, and error handling.

## Goals
- Reduce time-to-first-success to under 15 minutes for a new developer.
- Make the startup path explicit for three modes: CLI, Telegram (dev), Gateway.
- Eliminate config ambiguity and path mismatches between memory, sessions, transcripts, and logs.
- Make adding a new tool safe, repeatable, and well documented.
- Make errors actionable with clear next steps and visible log locations.

## Scope Reviewed
- README quickstart and linked docs
- Config files and docs
- Startup entrypoints for CLI, Telegram, and Gateway
- Tool registration and policy gating
- Error handling and logging patterns

## Current Friction Points

### README and Docs
- Quickstart is short but does not enumerate prerequisites, expected outputs, or common failure modes.
- The distinction between `dev:telegram`, `start:gateway`, and `dev:cli` is not clear to a new contributor.
- README does not mention `smoke:e2e` as the fastest wiring check.
- Config docs do not cover new fields present in `config/halo.example.json` (child-safe and semantic memory).
- Environment variables beyond the basics are not documented (`SQLITE_VEC_EXT`, `GATEWAY_HOST`, `GATEWAY_PORT`, `HALO_COMPACTION_ENABLED`, `HALO_DISTILLATION_ENABLED`, `GEMINI_API_KEY`, `LOG_DIR`).

### Config and Runtime Paths
- Two config files (`config.json` and `config/family.json`) must be kept in sync; this is easy to miss.
- `dev:telegram` and `dev:cli` write memory under the repo root but sessions and transcripts default to `HALO_HOME`. This is surprising and hard to debug.
- Semantic memory is enabled by default in `config/halo.example.json` but requires `SQLITE_VEC_EXT`. The first tool call can throw if the extension path is missing.

### Startup Flow
- Entry points throw on missing env/config, but there is no consistent “preflight” validator or human-friendly error summary.
- The system loads family config from `HALO_HOME/config/family.json` while writing memory to `rootDir`, which differs by entrypoint.
- There is no documented end-to-end “first run” sanity check for each mode.

### Tool Registration
- Tool lifecycle is spread across multiple files (tool definition, registry, tool names, policy allowlist, prime instructions, tests) but this flow is not documented.
- The deny-by-default stance is correct, but new tools can be accidentally unusable if policy updates are forgotten.

### Error Handling and Observability
- Errors are thrown with useful messages, but they are not consistently surfaced with a “what to do next.”
- Some runtime errors only show up in logs (events.jsonl) and the log path is not always obvious.
- There is no single “troubleshooting” page or “doctor” command to validate config and environment.

## Improvement Plan

### Phase 1: Quick Wins (Docs and Guidance)
1. Expand README Quickstart into a 3-path onboarding.
- Add a short “Choose your path” section:
  - `pnpm dev:cli` for a fast local check
  - `pnpm dev:telegram` for local Telegram-only
  - `pnpm build && pnpm start:gateway` for Gateway + Admin
- Include expected output strings and where logs are written for each path.

2. Add a dedicated “First Run” doc.
- New file: `docs/06-onboarding.md` with:
  - prerequisites (Node, pnpm, OS notes)
  - steps for each path
  - minimum config, environment, and expected outputs
  - “I can see Prime respond” checklist

3. Update `docs/04-config.md` to match actual config.
- Add sections for `childSafe` and `semanticMemory`.
- Document `semanticMemory` dependency on `SQLITE_VEC_EXT` and how to disable it.
- Document environment overrides (`GATEWAY_HOST`, `GATEWAY_PORT`, `SQLITE_VEC_EXT`).

4. Add a “Troubleshooting” section.
- New file: `docs/11-troubleshooting.md` with common errors and fixes:
  - missing `TELEGRAM_BOT_TOKEN`
  - missing `HALO_HOME/config.json` or `config/family.json`
  - invalid JSON in configs
  - missing `OPENAI_API_KEY` for model calls or embeddings
  - missing `SQLITE_VEC_EXT`
  - “unknown DM” behavior explained

5. Document tool registration flow.
- New file: `docs/12-tools.md` describing:
  - create tool in `src/tools/*`
  - add name in `src/tools/toolNames.ts`
  - register in `src/tools/registry.ts`
  - update policy allowlist in `src/policies/toolPolicy.ts`
  - update prime tool instructions in `src/prime/prime.ts`
  - add tests in `src/tools/*.test.ts` and `src/prime/prime.test.ts`

### Phase 2: Reduce Config and Path Friction
1. Unify runtime directories across entrypoints.
- Default all paths to `HALO_HOME` for memory, sessions, transcripts, and logs.
- For `dev:telegram` and `dev:cli`, accept an explicit `--root` or `HALO_HOME` override for local-only runs.
- Update docs to reflect the consistent behavior.

2. Provide config initialization and validation helpers.
- Add scripts:
  - `pnpm halo:config:init` to create both config files and keep them in sync.
  - `pnpm halo:config:validate` to run Zod validation and print friendly errors.
- Document these scripts in README and onboarding docs.

3. Reduce duplication between config files.
- Option A: Make `config.json` authoritative and auto-generate `config/family.json`.
- Option B: Make `family.json` authoritative and remove the embedded block from `config.json`.
- Document the chosen approach and migration steps.

### Phase 3: Error Handling and Developer UX
1. Add a preflight “doctor” command.
- New script `pnpm doctor` to check:
  - required env vars
  - config file existence and validity
  - semantic memory prerequisites
  - filesystem write permissions for HALO_HOME
- Use this to produce an actionable checklist.

2. Improve runtime error messaging.
- Wrap startup entrypoints with try/catch and print:
  - the error message
  - the file path involved
  - the next action to fix
- Include log paths (events, transcripts, sessions, memory) in error output.

3. Make tool errors user-friendly.
- For tools like semantic search, return a structured error like “semantic memory disabled” instead of a thrown exception when missing `SQLITE_VEC_EXT`.
- Document the behavior and fix path.

## Proposed Doc Changes
- `README.md`: expanded quickstart, three paths, expected outputs, smoke test mention.
- `docs/04-config.md`: new fields and env overrides.
- `docs/06-onboarding.md`: new “first run” guide.
- `docs/11-troubleshooting.md`: new troubleshooting page.
- `docs/12-tools.md`: new tool registration guide.

## Proposed Code/UX Changes (Follow-up Work)
- Align `rootDir` and `HALO_HOME` usage across CLI and Telegram dev paths.
- Add config init/validate scripts and document them.
- Add a “doctor” command for preflight checks.
- Make semantic memory opt-in or make missing `SQLITE_VEC_EXT` degrade gracefully.

## Suggested Ownership and Sequencing
- Docs updates can land first and provide immediate benefit.
- Path unification and helper scripts should follow, as they will change behavior.
- Error handling improvements can land incrementally without breaking API.

## Success Metrics
- New developer can run `pnpm dev:cli` and get a response in under 10 minutes.
- “I can run Telegram locally” steps are clear and do not require guesswork.
- Tool contribution path is documented and verified by tests.
- Common errors resolve within one attempt using the troubleshooting doc.
