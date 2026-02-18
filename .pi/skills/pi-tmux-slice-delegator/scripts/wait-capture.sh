#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  wait-capture.sh <session-name> [timeout-seconds]

Behavior:
  - Waits for __PI_DONE__ marker or timeout
  - Prints pane status and captured output
  - If JSON log marker exists, prints key lifecycle events from log
EOF
}

if [[ ${1:-} == "-h" || ${1:-} == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

SESSION_NAME="$1"
TIMEOUT_SECONDS="${2:-1800}"
INTERVAL=2
ELAPSED=0

if ! tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  echo "error: tmux session not found: $SESSION_NAME" >&2
  exit 1
fi

PANE_CWD=$(tmux display-message -p -t "$SESSION_NAME:0.0" "#{pane_current_path}" 2>/dev/null || true)

FOUND_DONE_MARKER=0
DONE_LINE=""
DONE_EXIT=""
LOG_FILE=""
if [[ -n "$PANE_CWD" ]]; then
  LOG_FILE="$PANE_CWD/.tmp/pi-runs/${SESSION_NAME}.jsonl"
fi

while true; do
  OUTPUT=$(tmux capture-pane -pt "$SESSION_NAME:0.0" -S -500)

  if [[ -z "$LOG_FILE" ]] && grep -Eq '^__PI_LOG__:.+$' <<< "$OUTPUT"; then
    LOG_FILE=$(grep -E '^__PI_LOG__:.+$' <<< "$OUTPUT" | tail -n1 | sed -E 's/^__PI_LOG__://')
  fi

  if grep -Eq '^__PI_DONE__:[0-9]+$' <<< "$OUTPUT"; then
    FOUND_DONE_MARKER=1
    DONE_LINE=$(grep -E '^__PI_DONE__:[0-9]+$' <<< "$OUTPUT" | tail -n1)
    DONE_EXIT="${DONE_LINE#__PI_DONE__:}"
    break
  fi

  DEAD=$(tmux list-panes -t "$SESSION_NAME" -F "#{pane_dead}" | head -n1)
  if [[ "$DEAD" == "1" ]]; then
    break
  fi

  if (( ELAPSED >= TIMEOUT_SECONDS )); then
    echo "timeout_reached=true"
    break
  fi

  sleep "$INTERVAL"
  ELAPSED=$((ELAPSED + INTERVAL))
done

echo "found_done_marker=$FOUND_DONE_MARKER"
if [[ -n "$DONE_LINE" ]]; then
  echo "done_line=$DONE_LINE"
fi
if [[ -n "$DONE_EXIT" ]]; then
  echo "done_exit=$DONE_EXIT"
fi
if [[ -n "$LOG_FILE" ]]; then
  echo "log_file=$LOG_FILE"
fi

echo "--- pane status ---"
tmux list-panes -t "$SESSION_NAME" -F "dead=#{pane_dead} exit=#{pane_exit_status}"

echo "--- captured output (markers) ---"
tmux capture-pane -pt "$SESSION_NAME:0.0" -S -500 | grep -E '__PI_DONE__|__PI_LOG__|^bash -lc|^pi --model' || true

if [[ -n "$LOG_FILE" && -f "$LOG_FILE" ]]; then
  echo "--- json lifecycle events (tail) ---"
  if command -v jq >/dev/null 2>&1; then
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
        "[agent_end] stopReason=" + (.stopReason // "unknown")
      else
        "[" + .type + "]"
      end
    ' "$LOG_FILE" | tail -n 80 || true
  else
    grep -E '"type":"(tool_execution_start|tool_execution_end|auto_compaction_start|auto_compaction_end|agent_end|auto_retry_start|auto_retry_end)"' "$LOG_FILE" | tail -n 80 | cut -c1-240 || true
  fi
fi
