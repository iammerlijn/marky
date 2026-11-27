#!/usr/bin/env bash
# Build and install the Flatpak for this user. Run from the repo root.
set -euo pipefail
flatpak-builder --user --install --install-deps-from=flathub --force-clean packaging/flatpak/build packaging/flatpak/io.github.iammerlijn.Marky.yml
