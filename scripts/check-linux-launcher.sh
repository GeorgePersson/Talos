#!/usr/bin/env bash
set -euo pipefail
test_dir=$(mktemp -d)
trap 'rm -rf -- "$test_dir"' EXIT
app_dir="$PWD/release/linux-unpacked"
[[ $(uname -m) == aarch64 ]] && app_dir="$PWD/release/linux-arm64-unpacked"
# Spaces and percent signs exercise shell and desktop-entry escaping.
export TALOS_INSTALL_PREFIX="$test_dir/Test User %"
bash "$app_dir/install.sh"
desktop-file-validate "$TALOS_INSTALL_PREFIX/share/applications/org.talosqa.desktop.desktop"
bash -n "$TALOS_INSTALL_PREFIX/bin/talos"
test -x "$app_dir/install.sh"
test -f "$TALOS_INSTALL_PREFIX/share/icons/hicolor/256x256/apps/org.talosqa.desktop.png"
