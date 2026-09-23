#!/usr/bin/env bash
# Pixels are compared on the same browser, fonts and architecture locally and in CI.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test -f "$REPO/dist/cedar-embeddable-term-picker/browser/index.html" || {
  echo "Run npm run build:production before testing visual baselines." >&2
  exit 1
}
exec docker run --rm --init --platform linux/arm64 --ipc=host \
  -v "$REPO":/repo \
  -v cetp-visual-node-modules:/repo/browser/node_modules \
  -w /repo/browser -e CI=1 -e CETP_VISUAL=1 \
  mcr.microsoft.com/playwright:v1.63.0-noble \
  bash -lc 'npm ci --no-audit --no-fund && npx playwright test visual-contract.spec.ts "$@"' -- "$@"
