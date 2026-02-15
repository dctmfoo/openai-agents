# Telegram Image → Direct Model Vision Wiring (Design Spec)

Status: **Implemented** (2026-02-06)

## Goal

When a user uploads an image in Telegram, route it to the model as **vision input** so the assistant can answer directly, instead of sending it through the file-search/vector-indexing upload path.

## Implementation notes (shipped)

- `message.photo` is now routed to a direct vision run path.
- `message.document` with `mime_type` starting `image/` is routed to the same direct vision path.
- Non-image `message.document` keeps the existing file-memory upload/indexing flow.
- Vision turns disable all tools (`web_search_call`, `read_scoped_memory`, `remember_daily`, `semantic_search`, `file_search`, `shell`) so image analysis stays direct model vision and avoids tool-loop latency.
- Vision turns bypass session-backed history persistence to avoid storing large base64 image payloads in long-lived chat sessions.
- Vision turns use a lightweight context mode (SOUL/USER only) and skip daily/long-term memory blocks to reduce per-turn prompt size and response latency.
- Vision turns apply a bounded model output budget (`maxTokens`) to keep image replies concise and reduce tail latency.
- Downloaded Telegram images are persisted under:
  - `HALO_HOME/memory/scopes/<scopeHash>/images/YYYY-MM-DD/<timestamp>-<source>-<messageId>-<fileUniqueId>.<ext>`
- Vision turns use structured `AgentInputItem[]` with:
  - `input_text` (caption when present, otherwise a default prompt)
  - `input_image` (`detail: "auto"`)

---

## Official documentation basis (traceability)

This design is derived from the following official docs only:

1. OpenAI Agents SDK `run()` accepts `string | AgentInputItem[] | RunState`
   - https://openai.github.io/openai-agents-js/openai/agents/functions/run/
2. OpenAI Agents SDK `AgentInputItem` type
   - https://openai.github.io/openai-agents-js/openai/agents/type-aliases/agentinputitem/
3. OpenAI Agents SDK `InputImage` protocol type (`type: "input_image"`, `image`, `detail`)
   - https://openai.github.io/openai-agents-js/openai/agents/openai/namespaces/protocol/type-aliases/inputimage/
4. OpenAI Agents SDK `fileSearchTool` is a vector-store search tool
   - https://openai.github.io/openai-agents-js/openai/agents-openai/functions/filesearchtool/
5. Telegram Bot API `Message` object (`photo`, `document`, `caption` fields)
   - https://core.telegram.org/bots/api#message
6. Telegram Bot API `getFile` for downloading files
   - https://core.telegram.org/bots/api#getfile
7. OpenAI Agents SDK model configuration guidance (`Agent.model`, runner/default model behavior)
   - https://openai.github.io/openai-agents-js/guides/models/

---

## Requirements derived from official docs

### R1 — Structured multimodal input must be supported
Use `run(agent, AgentInputItem[])` for image turns (not only string input).

### R2 — Image turns must use `input_image`
Image content sent to the model must use protocol shape compatible with `InputImage`.

### R3 — File-search path is separate from direct vision path
`fileSearchTool` is for vector-store retrieval. Image chat turns must not depend on vector-store indexing success/failure.

### R4 — Telegram image ingress must handle both message forms
Telegram can deliver user images as:
- `message.photo` (photo sizes array)
- `message.document` (e.g., image sent as file)

### R5 — Telegram media retrieval uses `getFile`
Image bytes/URL retrieval must use Telegram `getFile` flow.

### R6 — Vision path must run on a model configured for this agent runtime
Model choice is controlled by the repo’s Agents SDK model configuration strategy.

---

## Routing contract for Telegram adapter

For each incoming Telegram update, after existing policy/scope checks:

1. If `message.photo` exists → route to **vision run path**.
2. Else if `message.document` exists and represents an image (`mimeType` starts with `image/`) → route to **vision run path**.
3. Else if `message.document` exists and is non-image → route to existing **file-memory upload/index path**.
4. Else if `message.text` exists → route to existing **text run path**.

**Key rule:** image turns must bypass file-memory extension allowlist/indexing gates.

---

## Vision run input contract (SDK-level)

The vision path should construct a structured user message compatible with `AgentInputItem` and `InputImage`.

Example shape:

```ts
[
  {
    role: 'user',
    content: [
      { type: 'input_text', text: '<caption-or-user-question-or-default-prompt>' },
      { type: 'input_image', image: '<image-reference-string>', detail: 'auto' }
    ]
  }
]
```

Notes:
- `input_text` should use Telegram caption when present, otherwise a default prompt.
- Keep existing session/scope wiring so image turns remain in same conversation memory.

---

## Behavioral expectations

1. Uploading a Telegram photo should produce a direct assistant response (vision analysis), not a file-upload rejection.
2. Uploading an image as Telegram document should also produce direct vision response.
3. Uploading non-image documents should continue to use existing file-memory flow.
4. File-search availability should not affect direct image Q&A behavior.

---

## Verification checklist (post-implementation)

1. **Photo message test**
   - Send image via Telegram photo picker (`message.photo`).
   - Expected: assistant replies with image understanding.
2. **Image-as-document test**
   - Send `.jpg`/`.png` as file (`message.document`, `mime=image/*`).
   - Expected: assistant replies with image understanding (no extension gate rejection).
3. **Document indexing regression test**
   - Send PDF document.
   - Expected: existing file upload/index/search flow unchanged.
4. **Scope/session continuity**
   - Ask follow-up question about previously sent image in same chat.
   - Expected: normal conversation continuity via session behavior.

---

## Non-goals (this spec)

- Adding image files to vector-store/file-search indexing.
- OCR-specific pipelines.
- UI changes in admin app.

This spec only defines correct **routing and model invocation** for Telegram image messages using official SDK/Bot API contracts.
