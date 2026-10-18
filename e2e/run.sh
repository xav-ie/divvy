#!/usr/bin/env bash
# Run the Playwright suite inside the flake dev shell, which provides node 24
# and the nixpkgs Playwright browsers. Extra arguments go to `playwright test`.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ]]; then
  exec nix develop --command npx playwright test "$@"
fi
exec npx playwright test "$@"
