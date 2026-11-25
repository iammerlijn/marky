#!/usr/bin/env bash
# Visual tests in the Playwright container, on Linux and macOS: `npm run test:visual`.
# Extra arguments go to Playwright, for example `npm run test:visual -- --update-snapshots`.
# The container has its own node_modules (Linux packages), so the packages of the host do not matter.
# The exit code is the exit code of Playwright: not 0 when a test fails or no test runs.
set -euo pipefail
docker run --rm --network host \
  -e HOME=/tmp -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
  -v "$PWD":/work -v /work/node_modules -v marky-visual-npm:/tmp/.npm -w /work \
  mcr.microsoft.com/playwright:v1.65.1-noble \
  bash -euo pipefail -c '
    # On Linux, files that the container writes belong to root: give them back to the user.
    trap "chown -R \$HOST_UID:\$HOST_GID tests/visual/screenshots test-results 2> /dev/null || true" EXIT
    npm ci --silent --no-audit --no-fund
    npx playwright test "$@"
  ' _ "$@"
