#!/usr/bin/env bash
# Build and install the Flatpak for this user. Run from the repo root.
set -euo pipefail
npm run build
flatpak-builder --user --install --force-clean packaging/flatpak/build packaging/flatpak/nl.marky.Marky.yml
