#!/usr/bin/env bash
# Memory of the release app on macOS (design document, section 9). The macOS version of
# dev/measure-app.sh. Build first: `npx tauri build --no-bundle`.
#
# The value is the physical footprint (the "Memory" column of Activity Monitor) of the app and of
# the three WebKit processes that it starts. It is valid only while the window is in front: macOS
# releases the graphics memory of a window that is not visible. macOS does not let a script take
# the focus from the app that you use, so do not use the Mac while this runs (about 2 minutes).
# A sample with another app in front is not used.
set -euo pipefail
BIN=${BIN:-src-tauri/target/release/marky}
RUNS=${RUNS:-3}

# Marky is single-instance: a new process sends its files to an open Marky and stops.
if pgrep -x 'marky.*' > /dev/null; then
  echo "Marky is open. Quit it first." >&2
  exit 1
fi
# WebKit keeps the data (and the saved session) of a binary outside an app bundle under the name
# of the binary. A copy with its own name has its own session, so no saved tabs open.
COPY=$(mktemp -d)
cp "$BIN" "$COPY/marky-measure"
trap 'rm -rf "$COPY"' EXIT

mb() {
  footprint -p "$1" 2> /dev/null | awk '/phys_footprint:/ {v = $2; if ($3 == "KB") v /= 1024; printf "%d", v; exit}'
}

# The WebKit processes of the app: they have the same "responsible process" as the app (the app,
# or the terminal that started it). Activity Monitor uses the same value.
webkit_of() {
  python3 -I -c '
import ctypes, subprocess, sys
of = ctypes.CDLL(None).responsibility_get_pid_responsible_for_pid
for pid in subprocess.run(["pgrep", "-f", "com.apple.WebKit"], capture_output=True, text=True).stdout.split():
    if of(int(pid)) == of(int(sys.argv[1])): print(pid)
' "$1"
}

# Prints one line for each sample in front: app GPU network web total (MB).
measure() {
  local count=$1
  work='' app=''
  # Also after an error or Ctrl+C: stop the app and remove the files.
  trap 'kill $app 2> /dev/null || true; rm -rf "$work"' EXIT
  trap 'exit 1' INT TERM
  for _ in $(seq 1 "$RUNS"); do
    # New files for each run: the next run must not open the tabs of this session again.
    work=$(mktemp -d)
    for i in $(seq 1 "$count"); do cp dev/sample.md "$work/file$i.md"; done
    "$COPY/marky-measure" "$work"/*.md > /dev/null 2>&1 &
    app=$!
    sleep 3
    osascript -e "tell application \"System Events\" to set frontmost of (first process whose unix id is $app) to true" > /dev/null
    sleep 5
    for _ in 1 2 3 4 5 6; do
      if [ "$(lsappinfo info -only pid "$(lsappinfo front)" | sed 's/.*=//')" = "$app" ]; then
        # WebKit can start a spare web process, so add all the processes of each kind.
        local a g=0 n=0 w=0 pid m
        a=$(mb "$app")
        for pid in $(webkit_of "$app"); do
          m=$(mb "$pid")
          case $(ps -o comm= -p "$pid") in
            *GPU*) g=$((g + m)) ;;
            *Networking*) n=$((n + m)) ;;
            *WebContent*) w=$((w + m)) ;;
          esac
        done
        echo "$a $g $n $w $((a + g + n + w))"
      fi
      sleep 2
    done
    kill "$app" 2> /dev/null || true
    wait "$app" 2> /dev/null || true
    rm -rf "$work"
    sleep 2
  done
}

# The median of each column.
median() {
  awk '{for (i = 1; i <= 5; i++) v[i, NR] = $i}
    END {
      if (NR == 0) {print "no sample with the window in front"; exit}
      split("app gpu net web total", name)
      for (i = 1; i <= 5; i++) {
        for (j = 1; j <= NR; j++) s[j] = v[i, j]
        for (j = 1; j <= NR; j++) for (k = j + 1; k <= NR; k++) if (s[k] < s[j]) {t = s[j]; s[j] = s[k]; s[k] = t}
        printf "%s %d  ", name[i], s[int((NR + 1) / 2)]
      }
      printf "(%d samples)\n", NR
    }'
}

echo "Memory with 1 tab (MB physical footprint):"
measure 1 | median
echo "Memory with 10 tabs (MB physical footprint):"
measure 10 | median
