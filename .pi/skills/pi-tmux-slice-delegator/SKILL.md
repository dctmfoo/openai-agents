---
name: pi-tmux-slice-delegator
description: Delegate implementation slices to Pi in tmux using a fixed runtime profile. Use when you need to run a slice task in background, enforce TDD + explicit verification commands, and capture deterministic output from tmux.
---

# Pi tmux Slice Delegator

Use this skill to run slice work in a dedicated tmux session with the **mandatory** model configuration:

- `openai-codex/gpt-5.3-codex:xhigh`

## Hard rules

1. **Always use this model config** for tmux Pi sessions:
   - `--model openai-codex/gpt-5.3-codex:xhigh`
2. **Always provide explicit verification steps** in the delegated prompt.
3. Use `--mode json --print` for unattended execution unless interactive follow-up is explicitly needed.
4. Keep one slice per session for clean attribution.

## Files in this skill

- `scripts/spawn-slice.sh` — starts tmux session and launches Pi with fixed model config.
- `scripts/wait-capture.sh` — waits for completion and prints captured pane output.
- `templates/slice-prompt.md` — prompt template for delegation.

## Quick start

```bash
# 1) Create a prompt file from template
cp .pi/skills/pi-tmux-slice-delegator/templates/slice-prompt.md /tmp/slice-SXX.md

# 2) Fill /tmp/slice-SXX.md with the target slice scope and checks

# 3) Start delegation in tmux
.pi/skills/pi-tmux-slice-delegator/scripts/spawn-slice.sh \
  slice_sxx \
  /Users/nags/.openclaw/workspace/doot \
  /tmp/slice-SXX.md

# 4) Wait and capture output
.pi/skills/pi-tmux-slice-delegator/scripts/wait-capture.sh slice_sxx 1800
```

## Monitoring commands

```bash
# Attach live
tmux attach -t slice_sxx

# Capture pane output with deeper scrollback
tmux capture-pane -pt slice_sxx:0.0 -S -2000

# Stream JSON events directly from run log
# (spawn-slice prints log_file path; default location shown here)
tail -f .tmp/pi-runs/slice_sxx.jsonl

# Optional: watch key lifecycle events only (compact view)
jq -r '
  select(.type? and (
    .type == "tool_execution_start" or
    .type == "tool_execution_end" or
    .type == "auto_compaction_start" or
    .type == "auto_compaction_end" or
    .type == "auto_retry_start" or
    .type == "auto_retry_end" or
    .type == "agent_end"
  )) |
  if .type == "tool_execution_start" then
    "[tool_start] " + (.toolName // "unknown")
  elif .type == "tool_execution_end" then
    "[tool_end] " + (.toolName // "unknown") + " isError=" + ((.result.isError // false) | tostring)
  elif .type == "agent_end" then
    "[agent_end]"
  else
    "[" + .type + "]"
  end
' .tmp/pi-runs/slice_sxx.jsonl

# Pane status
tmux list-panes -t slice_sxx -F "dead=#{pane_dead} exit=#{pane_exit_status}"

# Cleanup
tmux kill-session -t slice_sxx
```

## Delegation prompt checklist (required)

Your prompt must include all of:

1. **Slice ID + objective**
2. **Allowed files / forbidden files**
3. **TDD rule**: red → green → refactor, one behavior slice at a time
4. **Verification commands** with expected success condition
5. **Handoff format** (what to report: tests run, files changed, risk notes)

If verification commands are missing, do not run delegation yet.
