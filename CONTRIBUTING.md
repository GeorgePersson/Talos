# Contributing to Talos

Keep the core workflow simple: a QA tester chooses an identity, opens the app
and inbox, and can trust that another identity's session is separate.

1. Install Node.js 22.12+ and run `npm ci`.
2. Run `npm start`; use `npm run demo` for a local test target.
3. Make a focused change and explain the tester-facing behaviour.
4. Run `npm run check` and `npm run format:check`. Use `npm run format` to format code.
   For distribution changes, also run `npm run pack` and `npm run smoke:packaged -- --automation`.

Start with [Discussions](https://github.com/GeorgePersson/Talos/discussions) for
questions and early ideas, or [Issues](https://github.com/GeorgePersson/Talos/issues)
for a bug or concrete feature suggestion. Search existing reports before opening
one. Issues labelled `good first issue` or `help wanted` are useful starting points;
ask in the issue before beginning a substantial change to avoid duplicated work.

Fork the repository, create a focused branch and open a pull request against
`main`. Explain the user-visible change, link its issue and provide verification.
CI checks are required for merging. Maintainer review covers scope, accessibility,
security and cross-platform behaviour. No CLA is required; your contribution is
licensed under MIT. Follow [our conduct policy](CODE_OF_CONDUCT.md).

Documentation, redacted compatibility reports, translation proposals and manual
platform testing are valuable contributions. See [the roadmap](docs/roadmap.md),
[governance](GOVERNANCE.md) and [release process](docs/releases.md).

Add an Electron integration test when changing session partitions, persistence,
reset, guest navigation, IPC or popup behaviour. Avoid tests that only mirror
markup. Never add production credentials, browser profiles, `.env` files or
downloaded user data to the repository.

Bug reports should include your OS, Talos/Electron version, steps to reproduce,
expected behaviour and actual behaviour. For login issues, name the identity
provider and whether it uses a popup or redirect. Redact tokens, email addresses,
screenshots of private messages and other sensitive information.

Good next contributions: provider compatibility reports, accessible navigation,
Omarchy/Hyprland acceptance checks, permission controls with explicit consent, and signed
release setup. Discuss substantial features before adding scope.

Use the same TypeScript source across Windows, macOS and Linux. Avoid OS-specific
paths or shell syntax in npm scripts. See [the Linux guide](docs/linux.md) for
desktop libraries, headless test commands and migration. Packaging changes must
preserve Chromium sandboxing; do not add `--no-sandbox` to launchers or CI tests.
The CI matrix includes both desktop CPU architectures on macOS/Linux and a
native Wayland test job. Hosted CI does not verify a physical Hyprland desktop.
