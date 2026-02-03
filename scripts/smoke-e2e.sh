#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

pnpm -s smoke:e2e
