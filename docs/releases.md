# Releasing Talos

Versions follow Semantic Versioning. Use `-rc.N` for release candidates. A
versioned candidate is not a claim that every supported platform has passed
acceptance. Document failures and known limitations in the release notes.

1. Update `package.json`, the lockfile and `CHANGELOG.md` together.
2. Run `npm ci`, `npm run check`, `npm run format:check` and `npm audit`.
3. Push the reviewed commit and verify every job in **Check Talos**. Native
   builds run on their own OS. Never package profiles, tokens or downloaded data.
4. Check the packaged smoke tests, Linux launcher and real Omarchy/Hyprland
   acceptance in `docs/linux.md`. Test real provider flows separately.
5. Tag the exact verified commit as `v<version>` and push that tag. CI creates a
   **draft** GitHub release from that run's native artifacts and SHA-256 checksums.
   A failed matrix never reaches the release job. No credentials are required
   for the local app or its automated fixture tests.
6. Review the draft's files, checksum contents, OS/CPU labels and release notes.
   Publish candidates as prereleases. Publish stable 1.0 only after acceptance;
   include signing status, installation steps and unresolved provider limits.

Builds currently have no Windows signing certificate or macOS notarization
credentials. Do not imply that they are signed. Configure signing using GitHub
secrets and the builder's documented options; never put signing material in
source. An unsigned macOS download may be blocked by Gatekeeper.

Artifacts are retained in Actions for 14 days. Releases preserve the reviewed
files. Checksums detect corruption; they do not replace code signing or prove
trust when obtained from a compromised source.

Security fixes receive priority. Keep supported Electron versions current and
review dependency update pull requests. Follow `SECURITY.md` for disclosure.
