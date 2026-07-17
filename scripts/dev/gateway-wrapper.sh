#!/usr/bin/env bash

# Supervisor loop for local gateway runtime.
# Exit code contract:
# - 43 => build + restart
# - 0  => normal shutdown
# - other => stop with same code

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
RESTART_EXIT_CODE="${HALO_RESTART_EXIT_CODE:-43}"
RESTART_DELAY_SECONDS="${HALO_RESTART_DELAY_SECONDS:-1}"

log_wrapper() {
  echo "[gateway-wrapper] $1"
}

run_gateway() {
  cd "$ROOT_DIR"
  pnpm exec tsx src/gateway/start.ts
}

log_wrapper "using repo: $ROOT_DIR"

while true; do
  log_wrapper "starting gateway"

  set +e
  run_gateway
  exit_code=$?
  set -e

  if [[ "$exit_code" -eq "$RESTART_EXIT_CODE" ]]; then
    log_wrapper "restart requested (exit $exit_code). running build"

    cd "$ROOT_DIR"
    if ! pnpm build; then
      log_wrapper "build failed; stopping"
      exit 1
    fi

    log_wrapper "build complete; restarting in ${RESTART_DELAY_SECONDS}s"
    sleep "$RESTART_DELAY_SECONDS"
    continue
  fi

  if [[ "$exit_code" -eq 0 ]]; then
    log_wrapper "gateway exited normally"
    exit 0
  fi

  log_wrapper "gateway exited with code $exit_code"
  exit "$exit_code"
done
