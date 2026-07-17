#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  spawn-slice.sh <session-name> <repo-path> <prompt-file> [extra-message...]

Behavior:
  - Starts a new tmux session
  - Runs Pi with fixed model config: openai-codex/gpt-5.3-codex:xhigh
  - Uses JSON event stream mode for deterministic monitoring
  - Uses --print for unattended execution
  - Mirrors JSON output to <repo>/.tmp/pi-runs/<session-name>.jsonl
EOF
}

if [[ ${1:-} == "-h" || ${1:-} == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -lt 3 ]]; then
  usage
  exit 1
fi

SESSION_NAME="$1"
REPO_PATH="$2"
PROMPT_FILE="$3"
shift 3

MODEL="openai-codex/gpt-5.3-codex:xhigh"
MODE="json"

if [[ ! -d "$REPO_PATH" ]]; then
  echo "error: repo path not found: $REPO_PATH" >&2
  exit 1
fi

if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "error: prompt file not found: $PROMPT_FILE" >&2
  exit 1
fi

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  echo "error: tmux session already exists: $SESSION_NAME" >&2
  exit 1
fi

LOG_DIR="$REPO_PATH/.tmp/pi-runs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/${SESSION_NAME}.jsonl"

CMD=(
  pi
  --model "$MODEL"
  --mode "$MODE"
  --print
  "@$PROMPT_FILE"
)

if [[ $# -gt 0 ]]; then
  CMD+=("$@")
fi

CMD_STRING="$(printf '%q ' "${CMD[@]}")"
LOG_FILE_Q="$(printf '%q' "$LOG_FILE")"
BASH_SNIPPET="LOG_FILE=${LOG_FILE_Q}; set -o pipefail; ${CMD_STRING} 2>&1 | tee \"\$LOG_FILE\"; STATUS=\${PIPESTATUS[0]}; printf '\n__PI_DONE__:%s\n' \"\$STATUS\"; printf '__PI_LOG__:%s\n' \"\$LOG_FILE\""
BASH_SNIPPET_Q="$(printf '%q' "$BASH_SNIPPET")"
RUN_STRING="bash -lc ${BASH_SNIPPET_Q}"

tmux new-session -d -s "$SESSION_NAME" -c "$REPO_PATH"
tmux set-option -t "$SESSION_NAME" remain-on-exit on

tmux send-keys -t "$SESSION_NAME" "$RUN_STRING" Enter

echo "started_session=$SESSION_NAME"
echo "repo_path=$REPO_PATH"
echo "model=$MODEL"
echo "mode=$MODE"
echo "prompt_file=$PROMPT_FILE"
echo "log_file=$LOG_FILE"
echo "attach=tmux attach -t $SESSION_NAME"
echo "capture=tmux capture-pane -pt $SESSION_NAME:0.0 -S -2000"
