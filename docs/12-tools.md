# Tools (Registration Guide)

Tools are deny-by-default. Every tool must be explicitly registered and allowlisted.

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
