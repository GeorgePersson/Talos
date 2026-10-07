# Third-party software

Talos's own source is MIT licensed; see `LICENSE`.

Packaged apps include Electron and Chromium. Their licence texts are preserved
as `LICENSE.electron.txt` and `LICENSES.chromium.html` alongside the runtime.
Do not remove these files when redistributing a build. Electron includes
additional components covered by the notices in that distribution.

The source build and tests use Electron, electron-builder, esbuild, TypeScript,
Prettier and Playwright. Their packages include their own licence files and
dependency notices. These development dependencies are installed by `npm ci`
and are not shipped as Talos runtime JavaScript dependencies. The bundled
Playwright adapter is Talos source; consumers install their own Playwright.
