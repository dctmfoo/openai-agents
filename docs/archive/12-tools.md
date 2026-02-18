# Tools (Registration Guide)

Tools are deny-by-default. Every tool must be explicitly registered and allowlisted.

## Current registered tools

- `web_search_call` (hosted web search)
- `read_scoped_memory` (read scoped long-term/today/yesterday markdown)
- `remember_daily` (append a scoped daily note)
- `semantic_search` (local semantic retrieval from scoped index)
- `file_search` (hosted OpenAI file search; enabled only when scope has a vector store and `fileMemory.enabled=true`)
- `shell` (local shell execution; enabled only when `tools.shell.enabled=true`, role command patterns are configured, and policy allowlists include `shell`)

Tool availability still depends on policy (`src/policies/toolPolicy.ts`).

## Shell tool notes

Shell access is deny-by-default with three gates:

1. `tools.shell.enabled` must be `true`
2. `tools.access` for the active role/scope must include `"shell"` in `allowedTools`
3. The role-specific `commandPolicy.<role>.allowedPatterns` must match the requested command (and `blockedPatterns` are always enforced first)

Allowlisting `"gog"` (or any other command name) in tool policy does **not** enable shell execution. The tool name is always `"shell"`; command-level control happens only via regex patterns.

Model note: OpenAI rejects `shell` on `gpt-4.1`. Prime now auto-selects `gpt-5.1` whenever shell is available unless you override with `PRIME_MODEL` (global) or `PRIME_SHELL_MODEL` (shell-only).

## Registering a tool

1. Implement the tool in `src/tools/`. Use `tool(...)` for local tools or `HostedTool` for OpenAI hosted tools.
2. Add a name in `src/tools/toolNames.ts`. Tool names are public IDs; keep them stable once released.
3. Register the tool in `src/tools/registry.ts`.
4. Allowlist the tool in `src/policies/toolPolicy.ts`. If you skip this, the tool will never be available.
5. Add usage instructions in `src/prime/prime.ts` so Prime knows when to call it.
6. Add tests in `src/tools/*.test.ts`, and update `src/prime/prime.test.ts` or policy tests if needed.
7. Run tests.

```bash
pnpm test
```

## Checklist

- Tool name added to `src/tools/toolNames.ts`
- Tool registered in `src/tools/registry.ts`
- Policy allowlist updated
- Prime instructions updated
- Tests added or updated
- Docs updated if the tool introduces new config or env vars
