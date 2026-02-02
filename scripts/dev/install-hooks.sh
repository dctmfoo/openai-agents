#!/usr/bin/env bash
set -euo pipefail

HOOKS_DIR_VALUE="${HOOKS_DIR:-}"
if [[ -n "$HOOKS_DIR_VALUE" ]]; then
  hooks_dir="$HOOKS_DIR_VALUE"
else
  git_dir="$(git rev-parse --git-dir 2>/dev/null || true)"
  if [[ -z "$git_dir" ]]; then
    echo "Unable to locate .git directory. Run from inside the repo or set HOOKS_DIR." >&2
    exit 1
  fi
  hooks_dir="$git_dir/hooks"
fi

mkdir -p "$hooks_dir"

cat <<'HOOK' > "$hooks_dir/pre-commit"
#!/usr/bin/env bash
set -euo pipefail

if [[ "${SKIP_PRECOMMIT:-}" == "1" ]]; then
  echo "Skipping pre-commit checks (SKIP_PRECOMMIT=1)."
  exit 0
fi

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

pnpm test
pnpm build
HOOK

chmod +x "$hooks_dir/pre-commit"

printf "Installed pre-commit hook to %s\n" "$hooks_dir/pre-commit"
