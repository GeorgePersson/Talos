# Talos on Linux and Omarchy

Talos targets modern glibc-based Linux desktops on x86-64 and ARM64. It bundles
Electron/Chromium; it does not depend on a separately installed system browser.
[Omarchy](https://omarchy.org/manual/omarchy-on/) uses Arch and Hyprland.
Talos uses Electron's native Wayland support automatically in a Wayland session,
and also runs on X11. No Hyprland configuration changes are needed for launch.

Windows is locally verified. Check [GitHub Actions](https://github.com/GeorgePersson/Talos/actions)
for native Linux/macOS builds and X11/Wayland test results for your chosen commit.
Headless Weston testing does not substitute for testing on an actual
Omarchy/Hyprland desktop. See the acceptance check below.

## Moving the source project to your new machine

Clone the repository on your new machine:

```sh
git clone https://github.com/GeorgePersson/Talos.git
cd Talos
```

Alternatively, copy the project folder, excluding `node_modules`, `dist`, `release`,
`test-results` and `artifacts`.
Keep `package-lock.json`. Install dependencies again on Linux; Windows Electron
and esbuild binaries in `node_modules` cannot run on Linux.

On Omarchy/Arch, install Node.js 22.12+ (24 recommended), npm and the desktop
runtime libraries if they are missing. Run the package operation through your
usual Omarchy/Arch package-management workflow; the equivalent pacman command is:

```sh
sudo pacman -Syu --needed nodejs npm gtk3 nss alsa-lib mesa libxss libxtst libnotify libsecret libxkbcommon libcups xdg-utils
```

From the Talos source directory, in your normal desktop terminal:

```sh
npm ci
npm start
```

Use `npm run start:automation` when you want the live Playwright endpoint.
The identity groups, API tester, locator picker, DevTools and webmail tabs use the
same application code on all three desktop operating systems.

## Build and install on Omarchy

```sh
npm run dist:linux
```

This builds for your machine's CPU architecture and writes an AppImage, a
portable `.tar.gz` archive, and an unpacked app to `release/`. To register the
unpacked x86-64 build in your application launcher:

```sh
bash release/linux-unpacked/install.sh
```

For ARM64, use `release/linux-arm64-unpacked/install.sh` instead. The installer
creates `~/.local/bin/talos`, a desktop entry and an icon. It requires no sudo
and leaves the application in its existing directory. Keep that directory in
place; rerun the installer if you move it. Launch **Talos** from the application
launcher, or run `~/.local/bin/talos`. Put `~/.local/bin` on PATH to use `talos`
directly in a terminal. Automation launch is `~/.local/bin/talos --qa-automation`.

A downloaded `.tar.gz` contains the same `install.sh` and `LINUX.md`: extract
it into a permanent folder, then run `bash ./install.sh` from that folder.
This option needs neither Node.js nor FUSE on the user's machine. For an
AppImage, mark it executable and run it:

```sh
chmod +x ./Talos-1.0.0-rc.2-linux-x86_64.AppImage
./Talos-1.0.0-rc.2-linux-x86_64.AppImage
```

Use the actual downloaded version and architecture in the filename. Legacy
AppImage runtimes can require FUSE 2 (`fuse2` on Arch). Use the archive if FUSE
is unavailable. Native DEB/RPM/pacman packages and Flatpak are not shipped yet.

To unregister the launcher, remove only these files (adjust the share paths if
you set `XDG_DATA_HOME`), then delete the application folder if no longer needed:

```sh
rm -- ~/.local/bin/talos
rm -- ~/.local/share/applications/org.talosqa.desktop.desktop
rm -- ~/.local/share/icons/hicolor/256x256/apps/org.talosqa.desktop.png
```

Removing the app or launcher does not remove saved browser profiles.

## Wayland and sandbox troubleshooting

Electron 44 automatically selects Wayland when `XDG_SESSION_TYPE=wayland`.
Do not set obsolete `ELECTRON_OZONE_PLATFORM_HINT` variables. For diagnosing a
display-specific issue, try `npm start -- --ozone-platform=x11` in an XWayland
session or `npm start -- --ozone-platform=wayland` in a Wayland session. Keep
the normal default unless a specific issue requires an override.

Talos does not position or resize its top-level windows after creation.
Hyprland manages tiling; the website view follows the window's content size.
Compositor shortcuts take precedence over application shortcuts. If a shortcut
conflicts with your setup, the browser menu provides the same actions.

Run as your regular desktop user. The Chromium sandbox needs working
unprivileged user namespaces or a correctly installed sandbox helper. Check
`unshare -Ur true` when diagnosing namespace access. Restricted distributions,
AppArmor policies and containers can prevent this even when the kernel supports
namespaces. Talos refuses `--no-sandbox`, including when an AppImage launcher
adds it automatically; the archive avoids that launcher's fallback. The archive
still needs a functioning Chromium sandbox. Do not disable it to browse websites.
Report the complete startup error and your distribution/security configuration
if the sandbox cannot start.

## Data when switching operating systems

Saved sessions live under Electron's normal user-data directory:

| Platform | Default directory |
| --- | --- |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/Talos` |
| Windows | `%APPDATA%/Talos` |
| macOS | `~/Library/Application Support/Talos` |

Do not transfer browser profile directories between operating systems. Cookie
encryption and Chromium profile compatibility can depend on the original OS.
Recreate saved groups and sign in again on Linux. Temporary groups are discarded
when the app exits. Downloaded files are independent of the profile.

## Omarchy desktop acceptance check

Before relying on Talos for daily QA, verify on your actual desktop:

1. Launch from the application launcher; confirm its name and icon.
2. Sign into your real website and webmail in two named groups. Confirm that
   shared tabs retain the group's login and other groups stay independent.
3. Exercise the real authentication popup/redirect flow. Provider restrictions
   on embedded browsers still apply on Linux.
4. Tile, resize, maximize and move the window between monitors; check the page,
   tab bar and QA drawer at your normal display scale.
5. Open docked and detached DevTools, use copy/paste and tab drag, then save a
   page screenshot through the native save dialog. Pick an element and copy its
   Playwright locator, including one inside an iframe.
6. Run an authenticated API request and the Playwright adapter, reset one group,
   and restart with a saved group. Confirm isolation throughout.

For Linux integration tests, run `npm run check` in your desktop session.
On headless X11, use `dbus-run-session -- xvfb-run -a npm run check`.
`bash scripts/check-wayland.sh` starts a temporary headless Weston compositor
for the same tests. CI exercises X11 x86-64/ARM64 and Wayland x86-64 and checks
the packaged app and desktop-entry installer.

References: [Electron Wayland support](https://www.electronjs.org/blog/tech-talk-wayland),
[Electron sandbox](https://www.electronjs.org/docs/latest/tutorial/sandbox),
[electron-builder Linux packaging](https://www.electron.build/v26/docs/linux/).
