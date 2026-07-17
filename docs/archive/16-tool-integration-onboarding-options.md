# 16) Tool Integration Onboarding — Options (Draft)

> Status: **Exploratory / not finalized**
>
> This document captures candidate approaches discussed for onboarding external tools (for example: `gog`, Notion, Slack, etc.).
> It is intentionally written as options and trade-offs, not a confirmed implementation plan.

## 1. Why this document exists

We are adding more capabilities over time, and each integration can introduce:

- setup complexity (install + auth + scopes)
- safety risk (writes, deletes, public sends)
- runtime reliability issues (binary missing, auth expired)
- policy ambiguity (who can use what, where, and how)

Goal: define a reusable onboarding process so each new integration does not reinvent the same safety and setup decisions.

## 2. Scope

In scope:

- External tool onboarding process (generic)
- Strategy options for setup, policy, approvals, and verification
- Runbook expectations per connector

Out of scope (for this draft):

- Final schema/field names in config
- Exact code architecture to implement now
- Hard commitment to a single option yet

## 3. Design principles (candidate)

1. **Core app should run without optional connectors.**
2. **Least privilege first** (read-only by default).
3. **Explicit capability gating** by role + scope.
4. **Operational clarity** (preflight checks + clear disabled reasons).
5. **Auditable behavior** (structured logs for connector actions).
6. **Reversible rollout** (easy disable + revoke path).

## 4. Integration strategy options

### Option A — Shell-first for everything

Use the shell tool plus command allowlist/denylist patterns for all integrations.

Pros:

- Fastest to ship initially
- Uniform execution mechanism
- Reuses existing shell policy framework

Cons:

- Regex policy gets complex quickly
- Harder to express intent-level permissions ("send email" vs command string)
- More brittle to CLI output/flag changes

### Option B — Function tools per capability

Wrap each high-level action as a typed function tool (for example: `gmail_search`, `drive_list`, `docs_create`) and optionally call shell/SDK inside the wrapper.

Pros:

- Clear API surface and narrower blast radius
- Better validation and approval targeting
- Easier testing and documentation

Cons:

- More implementation effort per connector
- More code to maintain

### Option C — MCP-first connectors where available

Prefer MCP servers for integrations when stable/maintained.

Pros:

- Standardized connector boundary
- Potential reuse across projects

Cons:

- Operational complexity may increase
- Dependency on MCP server quality + lifecycle

### Option D — Hybrid maturity model (phased)

Phase per connector:

1. Shell allowlisted (read-only)
2. Function-tool wrappers for stable operations
3. Optional MCP migration if justified

Pros:

- Practical path from speed to safety
- Avoids overdesign early

Cons:

- Transitional architecture to manage

## 5. Setup/onboarding model options

### Option 1 — Hard prerequisite model

Require all connector binaries/auth at project setup time.

Pros:

- Predictable environment

Cons:

- Heavy onboarding burden even for unused connectors
- Poor developer UX

### Option 2 — Optional connector model (recommended direction)

Core app install remains minimal; each connector is opt-in with explicit enablement.

Pros:

- Better usability
- Smaller failure surface

Cons:

- Need strong runtime status visibility to avoid confusion

### Option 3 — Lazy + auto-detect model

No explicit enablement; runtime discovers connector availability.

Pros:

- Low friction

Cons:

- Less deterministic behavior
- Harder change control

## 6. Capability/risk tiering options

Candidate tier model:

- **Tier R (Read-only):** search/list/get
- **Tier W (Write):** create/update/send
- **Tier D (Destructive/Public):** delete/publish/broadcast

Policy candidate:

- Tier R: can be enabled with standard allowlist
- Tier W: approval strongly recommended
- Tier D: approval required + optional extra confirmation

Open question:

- Should approval be global per tier, or configurable per tool/action?

## 7. Policy and governance options

### A. Tool-level policy only

Grant/deny by tool name (coarse).

### B. Capability-level policy (preferred direction)

Grant/deny by semantic action groups:

- `mail.read`, `mail.send`
- `drive.read`, `drive.write`, `drive.delete`
- etc.

Could map capability policy to tool exposure underneath.

### C. Context-aware policy

Include role + scope + time/quiet hours + environment.

Trade-off:

- Higher safety and control
- Higher policy complexity

## 8. Approval model options

### Option A — No approval (except destructive)

Simple, but risky for write operations.

### Option B — Approval for Tier W + Tier D

Balanced safety/default recommendation.

### Option C — Adaptive approval

`needsApproval` predicate based on:

- recipient/domain
- target folder/location
- content markers (sensitive/public)
- time windows

Most flexible, but higher implementation cost.

## 9. Preflight and readiness checks (candidate standard)

Each connector can expose a preflight that reports:

- binary/install status
- version compatibility
- auth status
- required scopes status
- account identity (if relevant)
- dry-run/read smoke status

Output should be machine-parseable and human-readable.

Possible command surfaces:

- `pnpm doctor` aggregate summary
- `pnpm connector:check <name>` for targeted diagnosis

## 10. Runbook expectations per connector

Per-tool runbook should include (minimum):

1. Purpose and capability map
2. Risk tier mapping (R/W/D)
3. Prerequisites (install, env, auth, scopes)
4. Enablement config + default policy
5. Verification commands + expected outcomes
6. Approval behavior
7. Logging/trace signals to watch
8. Failure modes + troubleshooting
9. Revocation/offboarding steps
10. Owner + last validation date

## 11. Observability and operations options

### Baseline (must-have)

- Structured logs for all connector executions:
  - connector name
  - action/capability
  - actor/scope
  - approval status
  - outcome + duration

### Optional enhancements

- Metrics per connector (success/failure/latency)
- Alerting for repeated auth failures
- Status endpoint exposing connector health

## 12. Rollout models

### Model A — Big-bang enablement

Enable connector for all parent scopes at once.

### Model B — Staged rollout (preferred direction)

- Stage 1: dry-run/read-only in one scope
- Stage 2: write with approval in one scope
- Stage 3: broader rollout

### Model C — Per-user opt-in

Enable only where explicitly requested.

## 13. Concrete example framing (gog)

`gog` is a good pilot connector because it spans read + write across multiple products.

Candidate first phase:

- enable read-only actions only
- require explicit approval for any write action (`docs create`, email send, etc.)
- keep strong guardrails if shell-backed

This should validate the onboarding process before scaling to other connectors.

## 14. Open questions (not resolved)

1. Should shell-backed integrations be temporary-only, or allowed as permanent for some connectors?
2. What is the default approval policy for Tier W actions?
3. How strict should version pinning be for external CLIs?
4. Where should capability policies live (single config vs per-connector files)?
5. Should connector onboarding block startup, or degrade gracefully with status warnings?
6. What minimum audit trail is required before enabling Tier D actions?

## 15. Suggested next step (decision workshop)

Before implementation, run a short decision pass and confirm:

1. Preferred integration strategy (A/B/C/D in section 4)
2. Setup model (section 5)
3. Tier + approval defaults (sections 6 and 8)
4. Required preflight output contract (section 9)
5. Runbook minimum bar (section 10)

Once those are decided, this draft can be converted into:

- a confirmed standard (`tool-onboarding-standard.md`)
- a per-tool runbook template
- connector-specific runbooks (starting with `gog`)
