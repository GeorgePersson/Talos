# Roadmap

## Stable 1.0 acceptance

- Pass the Windows, both macOS architectures, both Linux architectures and Wayland CI jobs.
- Test the packaged Linux build on a physical Omarchy/Hyprland desktop.
- Check app and inbox sign-in, including redirects and popups, against actual providers.
- Confirm saved-session restart and reset failures on supported platforms.
- Review unsigned distribution instructions and configure signing/notarization where available.
- Publish verified artifacts and SHA-256 checksums with clear platform limitations.

## Community suggestions

Useful future areas include keyboard/accessibility improvements, provider
compatibility reports, opt-in permission controls, saved workspace layouts,
and richer Playwright integration. These are ideas, not scheduled commitments.

Use [Discussions](https://github.com/GeorgePersson/Talos/discussions) to explore
an idea and the feature suggestion form for a concrete proposal. Keep the core
browser familiar and avoid duplicating Chromium DevTools.
