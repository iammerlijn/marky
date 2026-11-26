#!/usr/bin/env bash
# Fails when the frontend build is larger than the limit (issue 15, design document section 9).
# Build first: `npm run build`. Most of dist/ loads only when a document needs it, so the limit
# is for the download size, not for the start.
set -euo pipefail
LIMIT_MB=12
BYTES=$(du -sb dist | cut -f1)
LIMIT=$((LIMIT_MB * 1024 * 1024))
echo "dist/ is $((BYTES / 1024)) KB, the limit is $((LIMIT / 1024)) KB"
if [ "$BYTES" -gt "$LIMIT" ]; then
  echo "The build is larger than $LIMIT_MB MB. The largest files:"
  ls -S -s -k dist/assets | head -11 || true
  exit 1
fi
