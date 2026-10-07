# Changelog

## Unreleased

- Update GitHub Actions for checkout, Node setup and artifact upload/download,
  retaining pinned commit hashes. Check artifact upload/download compatibility
  on every CI run before using those actions for release files.
- Update esbuild to 0.28.2. Keep Node 24 typings and TypeScript 5 while compiler
  major upgrades receive a separate migration review.

## 1.0.0-rc.2

- Fresh workspaces now start with Account 1, Account 2 and Account 3. Groups
  remain editable; existing saved names are preserved.
- Neutral account examples throughout the welcome screen, local demo and
  Playwright integration guide.
- A captioned 35-second GIF and MP4 walkthrough, a demo transcript and clearer
  README instructions for grouping ordinary webmail tabs.

The signing, provider compatibility and physical Omarchy/Hyprland acceptance
limits described for the first candidate still apply.

## 1.0.0-rc.1

The first release candidate for the Talos QA workspace.

- Named isolated groups containing website and ordinary webmail tabs.
- Compact browser navigation, session reset/recovery and optional saved sessions.
- Chromium DevTools, page screenshots, find, zoom and browser shortcuts.
- Playwright locator picker, authenticated or independent API requests and an opt-in local automation adapter.
- Interface appearance settings with live preview.
- Restricted app protocol for the trusted shell, denied device permissions, sandboxed websites and validated IPC.
- One process per profile, bounded popups/tabs/downloads, bounded locator inspection and durable reset recovery writes.
- Bug/suggestion forms, Discussions, contributor guidance and native platform CI.

This candidate is unsigned. Native CI and manual Omarchy/Hyprland acceptance
must be reviewed before declaring stable 1.0 support. Provider sign-in
restrictions still apply; see the README.
