#!/usr/bin/env bash
# Run the app tests on this machine in a Debian container: WebKitWebDriver has no Arch package.
# The container builds the app from a copy of the repo. Cargo downloads stay in a Docker volume.
set -euo pipefail
docker run --rm -v "$PWD":/src:ro -v marky-e2e-cargo:/usr/local/cargo -v marky-e2e-target:/work/src-tauri/target \
  -e CARGO_HOME=/usr/local/cargo \
  node:26-bookworm bash -euo pipefail -c '
    apt-get update -qq
    apt-get install -y -qq libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf \
      webkit2gtk-driver xvfb dbus dbus-x11 curl build-essential > /dev/null
    export PATH=$CARGO_HOME/bin:$PATH RUSTUP_HOME=/usr/local/cargo/rustup
    command -v cargo > /dev/null || curl -sSf https://sh.rustup.rs | sh -s -- -y -q --profile minimal --default-toolchain 1.100.0 --no-modify-path
    command -v tauri-driver > /dev/null || cargo install -q tauri-driver --locked
    mkdir -p /work && cd /work
    tar -C /src --exclude=./node_modules --exclude=./src-tauri/target --exclude=./.flatpak-builder \
      --exclude=./packaging/flatpak/build --exclude=./dist --exclude=./dist-bench -cf - . | tar -xf -
    npm ci --silent
    npx tauri build --debug --no-bundle
    dbus-run-session -- xvfb-run --auto-servernum npm run test:e2e
  '
