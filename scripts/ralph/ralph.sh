#!/usr/bin/env bash
set -euo pipefail

# Ralph-style loop runner (Codex-first)
#
# Inspired by https://github.com/snarktank/ralph
# This repo-specific runner is intentionally small.
#
# Usage:
#   ./scripts/ralph/ralph.sh [max_iterations]
#
# Requirements:
#   - jq
#   - codex (logged in)
#   - pnpm
#
# Local artifacts (gitignored):
#   - prd.json
#   - progress.txt

MAX_ITERATIONS="${1:-10}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

PRD_JSON="${PRD_JSON:-$ROOT_DIR/prd.json}"
PROGRESS_TXT="${PROGRESS_TXT:-$ROOT_DIR/progress.txt}"

MODEL="${CODEX_MODEL:-gpt-5.2-codex}"
REASONING_EFFORT="${CODEX_REASONING_EFFORT:-high}"

PROMPT_TEMPLATE="${PROMPT_TEMPLATE:-$ROOT_DIR/scripts/ralph/prompt.codex.md}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require_file() {
  if [[ ! -f "$1" ]]; then
    echo "Missing required file: $1" >&2
    exit 1
  fi
}

require_cmd jq
require_cmd git
require_cmd pnpm
require_cmd codex

require_file "$PRD_JSON"
require_file "$PROMPT_TEMPLATE"

if [[ ! -f "$PROGRESS_TXT" ]]; then
  echo "# progress.txt (append-only)" > "$PROGRESS_TXT"
  echo "" >> "$PROGRESS_TXT"
fi

pick_next_story_id() {
  jq -r '.userStories[] | select(.passes == false) | .id' "$PRD_JSON" | head -n 1
}

story_json_by_id() {
  local id="$1"
  jq -c --arg id "$id" '.userStories[] | select(.id == $id)' "$PRD_JSON"
}

mark_story_passed() {
  local id="$1"
  local tmp
  tmp="$(mktemp)"
  jq --arg id "$id" '(.userStories[] | select(.id == $id) | .passes) = true' "$PRD_JSON" > "$tmp"
  mv "$tmp" "$PRD_JSON"
}

append_progress() {
  local text="$1"
  echo "- $(date -u +%F): $text" >> "$PROGRESS_TXT"
}

all_done() {
  [[ "$(jq -r '[.userStories[] | select(.passes == false)] | length' "$PRD_JSON")" == "0" ]]
}

run_checks() {
  pnpm -s test
  pnpm -s build
}

render_prompt() {
  local story_id="$1"
  local story
  story="$(story_json_by_id "$story_id")"

  cat "$PROMPT_TEMPLATE"
  echo ""
  echo "---"
  echo "Selected story id: $story_id"
  echo "Story JSON:"
  echo "$story"
  echo "---"
  echo ""
  echo "Now implement ONLY this story in the current git working tree. Do not commit."
}

ITER=1
while [[ "$ITER" -le "$MAX_ITERATIONS" ]]; do
  if all_done; then
    echo "<promise>COMPLETE</promise>"
    append_progress "COMPLETE: all stories passed"
    exit 0
  fi

  STORY_ID="$(pick_next_story_id)"
  if [[ -z "$STORY_ID" || "$STORY_ID" == "null" ]]; then
    echo "No pending stories found" >&2
    exit 1
  fi

  echo "---"
  echo "Iteration $ITER/$MAX_ITERATIONS: story $STORY_ID"

  # fresh codex run for this story
  render_prompt "$STORY_ID" | codex exec --full-auto -m "$MODEL" -c "reasoning.effort=\"$REASONING_EFFORT\"" -

  # runner owns checks + commit
  run_checks

  if [[ -n "$(git status --porcelain)" ]]; then
    git add -A

    # Never commit local artifacts (best-effort unstaging)
    git restore --staged --worktree --quiet prd.json progress.txt 2>/dev/null || true
    git restore --staged --quiet tasks reports archive 2>/dev/null || true

    if [[ -n "$(git diff --cached --name-only)" ]]; then
      git commit -m "ralph: ${STORY_ID}"
      mark_story_passed "$STORY_ID"
      append_progress "passed ${STORY_ID}"
    else
      echo "No staged changes after filtering (did Codex only touch ignored files?)." >&2
    fi
  else
    echo "No changes after story execution." >&2
  fi

  ITER=$((ITER + 1))
done

echo "Reached max iterations ($MAX_ITERATIONS)"
append_progress "STOP: max iterations reached"
exit 2
