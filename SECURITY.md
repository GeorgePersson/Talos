# Security

Talos embeds untrusted websites, so changes to sessions, permissions, preload,
IPC, popup handling and navigation need particular care. Keep Electron current.

Remote pages must keep `nodeIntegration: false`, `contextIsolation: true`,
`sandbox: true`, and `webSecurity: true`. Do not give them a preload API, disable
certificate checks, spoof identity providers to bypass restrictions, or grant
device permissions automatically.

Talos refuses the `--no-sandbox` startup flag, including AppImage launchers that
add it when user namespaces are unavailable. Integration and packaged-app tests
explicitly enable Playwright's Chromium sandbox. See the Linux setup guide for
namespace and display troubleshooting; do not weaken the sandbox to fix launch.

The shell receives a small command API; main-process handlers validate both the
sender's main frame and the command data. Session IDs and partition names are
generated in the main process, never chosen by websites.

The API editor is a user-controlled main-process HTTP(S) client. It validates
methods, addresses, headers and payload sizes, bounds response previews, and
aborts on timeout or group reset. It can access localhost and internal services
for QA purposes; it must never be exposed as an unauthenticated remote API.
The locator picker temporarily attaches a local Chromium debugger to the active
website. DOM inspection runs in an isolated world without Node or a preload.
Generated locator text is displayed/copied, never evaluated by the app. The
connection detaches on selection, cancellation, navigation, reset or tab close.
Picked metadata stays in memory; no network or console log is collected by Talos.

`--qa-automation` enables a localhost CDP endpoint on an ephemeral port. There is
no authentication on this endpoint: a connected local process can control all
groups and the trusted shell. Keep it disabled by default and only enable it
while using trusted automation. Do not change the binding to a public interface.

Before clearing storage, all pages and popups in the affected group must close.
Never reuse an account after a failed reset. Do not claim temporary sessions
erase downloads, server-side state, OS-level authentication or all traces.

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/GeorgePersson/Talos/security/advisories/new).
Do not include sensitive exploit details or login data in public issues.
Include the Talos version, OS, reproduction using dummy accounts and the expected
security boundary. The maintainer aims to acknowledge reports within seven days;
this is a volunteer project without a guaranteed response time. Coordinate public
disclosure after a fix or agreed mitigation is available.

The latest 1.0 release candidate receives security fixes while stable 1.0 is being
validated. Earlier prototypes are unsupported. Once 1.0 is stable, the latest
1.x release will be supported; upgrade to current patch releases.

The trusted interface lives in an in-memory shell partition at `talos://app`.
Packaged builds disable Electron's Node runtime mode, Node environment options
and extra file-protocol privileges. They load only `app.asar` and validate its
embedded integrity on supported platforms. Node CLI inspection remains available
for Electron QA tooling and packaged smoke tests; enabling it is a local launch
decision with main-process access. Website Playwright automation uses the
separate, explicit `--qa-automation` switch. Unsigned binaries are not protected
from tampering by code signing.
Only six renderer assets are exposed by its protocol; remote group partitions
have no protocol handler or preload. Device permissions are denied in every
partition. Up to 30 groups, 100 tabs, eight popups per group and five concurrent
downloads per group are allowed. Downloads use a save dialog and active downloads
are cancelled on group reset; files already saved are left on disk.

One app process owns each profile. Reset persists and flushes its recovery block
before touching storage; a failed recovery write leaves the original session
open and reports failure. Failed cleanup keeps the saved group blocked. Session
data still follows Chromium's normal on-disk behaviour, without an app-level
master password. Temporary sessions are not a promise of complete trace removal.
