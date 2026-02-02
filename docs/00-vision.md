# Vision

Build a **personal AI companion** ("Prime") using the **OpenAI Agents SDK (TypeScript)**.

Prime should behave like a *digital proxy*:

- Can help with real workflows (code/repo work, research, planning, admin)
- Can take actions through tools, but only with **least privilege**
- Can remember things via a **tiered memory** approach
- Is safe by default via **verification and approval gates**

## Non-goals (for now)

- A general-purpose “everything agent” that can do arbitrary unsafe actions
- Fully autonomous long-running background agents without guardrails
- Fancy UI/dashboard/voice on day 1

## Design inspirations

This project follows common personal-companion architecture patterns:

- One main orchestrator (“Prime”)
- Specialists delegated as tools or via handoffs (context isolation)
- File-first memory (hot/warm), optional semantic layer later
- “Swiss cheese” safety: multiple layers of verification
- Evals-driven development

## Success criteria (v1)

- You can run Prime locally (CLI) and it completes a useful task end-to-end.
- Prime can use at least 2–3 tools safely.
- Prime writes logs + memory updates deterministically.
- A small regression eval suite prevents obvious breakages.
