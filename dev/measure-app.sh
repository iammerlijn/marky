#!/usr/bin/env bash
# Cold start and memory of the release app (design document, section 9). Linux only.
# Build first: `npx tauri build --no-bundle`. No other Marky may run: the app is single-instance.
# A separate XDG_DATA_HOME makes sure that no saved session opens.
set -euo pipefail
BIN=${BIN:-src-tauri/target/release/marky}
WORK=$(mktemp -d)
export XDG_DATA_HOME=$WORK/data MARKY_BENCH=1
for i in $(seq 1 10); do cp dev/sample.md "$WORK/file$i.md"; done

# Starts the app with the files. Sets APP to its process ID, and MS to the time until the files
# are open and painted. Not in a subshell: then APP would be lost.
start() {
  : > "$WORK/log"
  "$BIN" "$@" > /dev/null 2> "$WORK/log" &
  APP=$!
  for _ in $(seq 1 400); do
    grep -q 'marky-bench files-open' "$WORK/log" && break
    sleep 0.05
  done
  MS=$(awk '/marky-bench files-open/ {print $3}' "$WORK/log")
}

mark() {
  awk -v label="$1" '$2 == label {print $3}' "$WORK/log"
}

stop() {
  kill "$APP" 2> /dev/null || true
  wait "$APP" 2> /dev/null || true
}

tree() {
  echo "$1"
  for child in $(pgrep -P "$1"); do tree "$child"; done
}

# Proportional set size of the app and all its processes (WebKit web and network processes).
pss_mb() {
  local total=0
  for pid in $(tree "$1"); do
    total=$((total + $(awk '/^Pss:/ {print $2}' "/proc/$pid/smaps_rollup" 2> /dev/null || echo 0)))
  done
  echo $((total / 1024))
}

echo "Cold start to the painted document (ms), 5 starts. Also: page script start, editor ready:"
for _ in 1 2 3 4 5; do
  start "$WORK/file1.md"
  stop
  echo "$MS  (script $(mark script), editor $(mark editor), opened before paint $(mark opened))"
done

echo "Memory with 1 tab (MB PSS):"
start "$WORK/file1.md"
sleep 3
pss_mb "$APP"
stop

echo "Memory with 10 tabs (MB PSS):"
start "$WORK"/file*.md
sleep 3
pss_mb "$APP"
for pid in $(tree "$APP"); do
  echo "  $(awk '/^Pss:/ {print int($2 / 1024)}' "/proc/$pid/smaps_rollup" 2> /dev/null) MB  $(tr '\0' ' ' < "/proc/$pid/cmdline" | cut -c1-60)"
done
stop
rm -rf "$WORK"
