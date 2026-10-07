# Playwright + Talos

Use standard Playwright against the groups and tabs open in Talos. This adapter
maps CDP target IDs to Talos group IDs, so two groups at the same URL are not
confused with each other. Inboxes and website tabs are exposed separately.

1. Close other Talos instances, then run `npm run start:automation`. For a packaged
   application, run `Talos.exe --qa-automation` on Windows, `talos --qa-automation`
   on Linux, or `open -a Talos --args --qa-automation` on macOS. Close the existing
   app first: a second launch focuses the process already using that profile.
2. Open your websites, attach inboxes, and sign into each identity normally.
3. Choose **QA tools → Playwright** and copy the localhost endpoint.
4. From this project, try `npm run playwright:connect -- http://127.0.0.1:PORT`.
   This example lists groups and page titles without changing the website.

For tests in another project, copy `talos.cjs` into it and install `playwright`
or `@playwright/test`. Pass the imported `chromium` object to `connectTalos`.
Packaged builds include the adapter and this guide in
`resources/playwright-adapter/`. The app's Playwright panel generates a snippet
using that adapter's exact file URL.

```js
// Save as live-test.mjs in the Talos project and run: node live-test.mjs
import { chromium } from "playwright";
import adapter from "./integrations/playwright/talos.cjs";

const talos = await adapter.connectTalos(chromium, "http://127.0.0.1:PORT");
try {
  const investor = await talos.group("Investor");
  const page = investor.websites[0];
  console.log(await page.title());
  // await page.getByRole('button', { name: 'Continue' }).click();
  // await page.screenshot({ path: 'investor.png' });
  // const inbox = investor.inboxes[0];
} finally {
  await talos.disconnect();
}
```

- `talos.groups()` returns `{ id, name }` entries for groups with open tabs.
- `talos.group(nameOrId)` returns `websites`, `inboxes`, and `tabs` (each tab
  contains a Playwright `page` and Talos metadata). Use an ID for duplicate names.
- `talos.page(tabId)` resolves one specific tab.
- `talos.browser` is the connected Playwright browser; contexts support normal
  tracing, and pages support locators, assertions, screenshots and evaluation.
- `talos.disconnect()` disconnects your client and leaves Talos running.

Only enable automation while testing with trusted local tools. The endpoint is
bound to localhost and uses an ephemeral port, but has no password. A connected
client can control all groups and the privileged local shell. Normal launches
do not enable this endpoint. Multiple clients and DevTools can coexist, but
conflicting instrumentation (routing, emulation or debugger commands) may
interfere with each other. Coordinate such settings in your test setup.

[Playwright documents CDP connections](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp) as lower fidelity than its native protocol.
Do not assume every Playwright context option, fresh browser creation, extension,
or tracing mode works identically in Electron. This integration is verified for
connecting to live group pages, using locators, preserving sessions and
disconnecting without closing Talos. It does not run arbitrary plugin code in
Talos or include a test-script editor/runner.
