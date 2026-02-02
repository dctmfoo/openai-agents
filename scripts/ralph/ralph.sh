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

BASE_BRANCH="${RALPH_BASE_BRANCH:-main}"
ALLOW_MAIN="${RALPH_ALLOW_MAIN:-0}"

# We run in an isolated worktree so humans can keep using the main repo checkout.
WORKTREES_DIR="${RALPH_WORKTREES_DIR:-$ROOT_DIR/.ralph-worktrees}"

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

# Resolve the desired branch name from prd.json (Ralphy/Ralph-style).
BRANCH_NAME="$(jq -r '.branchName // empty' "$PRD_JSON" 2>/dev/null || true)"
if [[ -z "$BRANCH_NAME" || "$BRANCH_NAME" == "null" ]]; then
  echo "Missing prd.json.branchName. Set it (recommended) or export RALPH_BRANCH_NAME." >&2
  BRANCH_NAME="${RALPH_BRANCH_NAME:-}" 
fi

if [[ -z "$BRANCH_NAME" ]]; then
  echo "Unable to determine branch name. Please set prd.json.branchName or RALPH_BRANCH_NAME." >&2
  exit 1
fi

if [[ "$BRANCH_NAME" == "main" && "$ALLOW_MAIN" != "1" ]]; then
  echo "Refusing to run Ralph on branch 'main'. Set prd.json.branchName to a feature branch or export RALPH_ALLOW_MAIN=1." >&2
  exit 1
fi

mkdir -p "$WORKTREES_DIR"
WORKTREE_DIR="$WORKTREES_DIR/$BRANCH_NAME"

# Create/update the worktree (isolated checkout).
git fetch --quiet origin "$BASE_BRANCH" || true
# If a worktree already exists for this branch, reuse it. Otherwise create it.
if [[ -d "$WORKTREE_DIR/.git" ]]; then
  echo "Reusing existing worktree: $WORKTREE_DIR"
else
  # If the branch is already checked out in some other worktree, reuse that path.
  EXISTING_PATH="$(git worktree list --porcelain | awk -v b="refs/heads/$BRANCH_NAME" '
    $1=="worktree"{p=$2}
    $1=="branch" && $2==b{print p; exit}
  ')"

  if [[ -n "$EXISTING_PATH" ]]; then
    echo "Branch '$BRANCH_NAME' already has a worktree at: $EXISTING_PATH"
    WORKTREE_DIR="$EXISTING_PATH"
  else
    mkdir -p "$WORKTREE_DIR"
    # If the branch exists on origin, use it; else branch off base.
    if git show-ref --verify --quiet "refs/remotes/origin/$BRANCH_NAME"; then
      git worktree add -B "$BRANCH_NAME" "$WORKTREE_DIR" "origin/$BRANCH_NAME"
    else
      git worktree add -B "$BRANCH_NAME" "$WORKTREE_DIR" "origin/$BASE_BRANCH"
    fi
  fi
fi

# Speed: reuse the root node_modules if present.
if [[ -d "$ROOT_DIR/node_modules" && ! -e "$WORKTREE_DIR/node_modules" ]]; then
  ln -s "$ROOT_DIR/node_modules" "$WORKTREE_DIR/node_modules" 2>/dev/null || true
fi

cd "$WORKTREE_DIR"

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
