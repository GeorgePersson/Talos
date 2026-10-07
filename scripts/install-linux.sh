#!/usr/bin/env bash
set -euo pipefail

# Register an extracted Talos build in this user's launcher. Keep the app in place.
if [[ $(id -u) == 0 ]]; then
  echo "Run this installer as your desktop user, without sudo." >&2
  exit 1
fi
app_dir=$(realpath -- "${1:-$(dirname -- "${BASH_SOURCE[0]}")}")
binary="$app_dir/talos"
if [[ ! -x "$binary" || ! -f "$app_dir/resources/app.asar" || ! -f "$app_dir/talos.png" ]]; then
  echo "Expected an extracted Linux Talos build with talos, resources/app.asar and talos.png." >&2
  echo "Usage: bash install.sh [path-to-linux-unpacked]" >&2
  exit 1
fi
data_dir="${TALOS_INSTALL_PREFIX:+$TALOS_INSTALL_PREFIX/share}"
data_dir="${data_dir:-${XDG_DATA_HOME:-$HOME/.local/share}}"
bin_dir="${TALOS_INSTALL_PREFIX:-$HOME/.local}/bin"
if [[ "$data_dir" != /* || "$bin_dir" != /* || "$data_dir" == *$'\n'* || "$app_dir" == *$'\n'* || "$bin_dir" == *$'\n'* ]]; then
  echo "Installation paths must be absolute and must not contain newlines." >&2
  exit 1
fi
mkdir -p -- "$bin_dir" "$data_dir/applications" "$data_dir/icons/hicolor/256x256/apps"
printf '#!/usr/bin/env bash\nexec %q "$@"\n' "$binary" > "$bin_dir/talos"
chmod 755 -- "$bin_dir/talos"
cp -- "$app_dir/talos.png" "$data_dir/icons/hicolor/256x256/apps/org.talosqa.desktop.png"

# Desktop Entry Exec has its own escaping, separate from POSIX shell quoting.
desktop_exec="$bin_dir/talos"
desktop_exec=${desktop_exec//\\/\\\\\\\\}
desktop_exec=${desktop_exec//\"/\\\"}
desktop_exec=${desktop_exec//\$/\\\$}
desktop_exec=${desktop_exec//\`/\\\`}
desktop_exec=${desktop_exec//%/%%}
cat > "$data_dir/applications/org.talosqa.desktop.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Talos
Comment=Multi-account QA browser
Exec="$desktop_exec"
Icon=org.talosqa.desktop
Terminal=false
Categories=Development;Network;
Keywords=QA;Testing;Browser;Playwright;
StartupWMClass=org.talosqa.desktop
EOF
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$data_dir/applications"
fi
echo "Talos is registered in your application launcher. Keep this app directory: $app_dir"
echo "Terminal launch: $bin_dir/talos"
