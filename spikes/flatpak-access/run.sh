#!/usr/bin/env bash
# Runs the file-access check in each case. Usage: ./run.sh (after the build in README.md).
set -u
APP=nl.marky.FlatpakAccess
LOCAL=./target/release/flatpak-access

# After READY, change the file on the host: first in place, then with an atomic replace (as vim and git do).
run_case() {
  local label=$1 file=$2; shift 2
  mkdir -p "$(dirname "$file")"
  printf 'line one\n' > "$file"
  chmod 640 "$file"
  echo "== $label"
  "$@" "$file" 2>&1 | while IFS= read -r line; do
    echo "   $line"
    [[ $line == path* ]] && echo "${line#path  }" > /tmp/marky-spike-lastpath
    if [[ $line == READY ]]; then
      (sleep 1; echo 'changed in place' >> "$file"
       sleep 1; { cat "$file"; echo 'changed by atomic replace'; } > "$file.new" && mv "$file.new" "$file") &
    fi
  done
  wait
}

portal() { local f=$1; flatpak run --user --file-forwarding "$APP" @@ "$f" @@; }
portal_poll() { local f=$1; flatpak run --user --env=WATCH=poll --file-forwarding "$APP" @@ "$f" @@; }
home() { flatpak run --user --filesystem=home "$APP" "$1"; }
host() { flatpak run --user --filesystem=host "$APP" "$1"; }
reopen() { flatpak run --user "$APP" "$(cat /tmp/marky-spike-lastpath)"; }

for dir in "$HOME/marky-spike" /tmp/marky-spike; do
  run_case "no sandbox, $dir" "$dir/test.md" "$LOCAL"
  run_case "portal (file forwarding, no permission), $dir" "$dir/test.md" portal
  run_case "portal with PollWatcher, $dir" "$dir/test.md" portal_poll
  # The next start of the app uses the stored path, as "reopen last session" does.
  run_case "portal, second start with the stored path, $dir" "$dir/test.md" bash -c "$(declare -f reopen); APP=$APP; reopen" _
  run_case "--filesystem=home, $dir" "$dir/test.md" home
  run_case "--filesystem=host, $dir" "$dir/test.md" host
done
rm -f /tmp/marky-spike-lastpath
