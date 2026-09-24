#!/usr/bin/env bash
# Pixels are compared on the same browser, fonts and architecture locally and in CI.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test -f "$REPO/dist/cedar-embeddable-term-picker/browser/index.html" || {
  echo "Run npm run build:production before testing visual baselines." >&2
  exit 1
}
# Own the container as well as the Docker client, including interrupted builds.
CONTAINER="cetp-tests-$$-${RANDOM}"
cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
docker run --name "$CONTAINER" --rm --init --platform linux/arm64 --ipc=host \
  -e CEDAR_TEST_WORKERS="${CEDAR_TEST_WORKERS:-}" \
  -v "$REPO":/repo \
  -v /repo/browser/node_modules \
  -w /repo/browser -e CI=1 -e CETP_VISUAL=1 \
  mcr.microsoft.com/playwright:v1.63.0-noble \
  bash -lc 'npm ci --no-audit --no-fund && npx playwright test visual-contract.spec.ts "$@"' -- "$@"
