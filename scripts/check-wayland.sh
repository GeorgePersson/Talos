#!/usr/bin/env bash
set -euo pipefail
# CI uses Weston to exercise native Wayland without a physical display.
# Omarchy/Hyprland still needs a real-desktop acceptance check.
export XDG_RUNTIME_DIR
XDG_RUNTIME_DIR=$(mktemp -d)
chmod 700 "$XDG_RUNTIME_DIR"
export WAYLAND_DISPLAY=talos-test-wayland
export XDG_SESSION_TYPE=wayland
unset DISPLAY
weston --backend=headless-backend.so --socket="$WAYLAND_DISPLAY" --idle-time=0 --width=1600 --height=1000 > "$XDG_RUNTIME_DIR/weston.log" 2>&1 &
compositor_pid=$!
cleanup() {
  kill "$compositor_pid" 2>/dev/null || true
  wait "$compositor_pid" 2>/dev/null || true
  cat "$XDG_RUNTIME_DIR/weston.log"
  rm -rf -- "$XDG_RUNTIME_DIR"
}
trap cleanup EXIT
for attempt in {1..100}; do
  [[ -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ]] && break
  kill -0 "$compositor_pid" || exit 1
  sleep 0.1
done
[[ -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ]]
dbus-run-session -- npm run check
