#!/usr/bin/env bash
# Make the offline sources of the Flatpak from the lockfiles. Run from the repo root.
# Needs a clone of https://github.com/flatpak/flatpak-builder-tools in FLATPAK_BUILDER_TOOLS,
# the Python packages aiohttp and tomlkit, and flatpak-node-generator (pip install "$FLATPAK_BUILDER_TOOLS/node").
set -euo pipefail
tools=${FLATPAK_BUILDER_TOOLS:?set FLATPAK_BUILDER_TOOLS to a clone of flatpak-builder-tools}
python3 "$tools/cargo/flatpak-cargo-generator.py" src-tauri/Cargo.lock -o packaging/flatpak/cargo-sources.json

# --no-devel also skips "devOptional" packages, but `npm ci --omit=dev` installs them.
# So the generator gets a copy of the lockfile where they are only "optional".
lock=$(mktemp -d)
trap 'rm -rf "$lock"' EXIT
python3 - package-lock.json "$lock/package-lock.json" <<'EOF'
import json, sys
lock = json.load(open(sys.argv[1]))
for info in lock['packages'].values():
    if info.pop('devOptional', False):
        info['optional'] = True
json.dump(lock, open(sys.argv[2], 'w'), indent=2)
EOF
flatpak-node-generator --no-devel npm "$lock/package-lock.json" -o packaging/flatpak/node-sources.json
