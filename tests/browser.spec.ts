import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { chromium } from "@playwright/test";
// @ts-ignore Adapter is intentionally usable as plain CommonJS by consumers.
import { connectTalos } from "../integrations/playwright/talos.cjs";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
// @ts-ignore The fixture server is a shared executable ES module.
import { startFixture } from "../scripts/fixture-server.cjs";
let app: ElectronApplication;
let shell: Page;
let dataDir: string;
let fixture: Awaited<ReturnType<typeof startFixture>>;
const command = (value: object) =>
  shell.evaluate((value) => (window as any).qa.command(value), value);
const state = () => shell.evaluate(() => (window as any).qa.state());
async function launch(extraArgs: string[] = []) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    chromiumSandbox: true,
    args: [".", `--qa-user-data=${dataDir}`, ...extraArgs],
    env,
  });
  await expect
    .poll(() =>
      app.windows().some((page) => page.url().endsWith("/index.html")),
    )
    .toBe(true);
  shell = app.windows().find((page) => page.url().endsWith("/index.html"))!;
  await shell.waitForFunction(() => !!(window as any).qa);
  await expect.poll(async () => (await state()).tabs.length).toBeGreaterThan(0);
  expect(
    await app.evaluate(({ app }) => app.commandLine.hasSwitch("no-sandbox")),
  ).toBe(false);
}
async function content(url: string, script: string) {
  return app.evaluate(
    async ({ webContents }, { url, script }) => {
      const contents = webContents
        .getAllWebContents()
        .find((wc) => wc.getURL() === url);
      if (!contents) throw new Error(`No guest at ${url}`);
      return contents.executeJavaScript(script);
    },
    { url, script },
  );
}
async function ready(url: string) {
  await expect
    .poll(async () => {
      try {
        return await content(url, "typeof window.fixture");
      } catch {
        return "";
      }
    })
    .toBe("object");
}
test.beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "talos-test-"));
  fixture = await startFixture();
  await launch();
});
test.afterEach(async () => {
  if (app) await app.close();
  await fixture.close();
  await rm(dataDir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 300,
  });
});

test("trusted shell serves only public assets and websites cannot acquire its bridge", async () => {
  expect(shell.url()).toBe("talos://app/index.html");
  const responses = await app.evaluate(async ({ session }) => {
    const ses = session.fromPartition("talos-shell");
    const statuses = [];
    for (const pathname of [
      "index.html",
      "main.js",
      "preload.js",
      "../package.json",
      "%2e%2e%2fpackage.json",
    ])
      statuses.push((await ses.fetch(`talos://app/${pathname}`)).status);
    statuses.push((await ses.fetch("talos://other/index.html")).status);
    return statuses;
  });
  expect(responses).toEqual([200, 404, 404, 404, 404, 404]);
  await command({ type: "navigate", url: fixture.url });
  await ready(`${fixture.url}/`);
  await content(
    `${fixture.url}/`,
    `(() => {
    const frame = document.createElement('iframe');
    frame.id = 'untrusted-frame'; frame.src = 'talos://app/index.html';
    document.body.appendChild(frame);
    return true;
  })()`,
  );
  await expect
    .poll(() =>
      content(
        `${fixture.url}/`,
        `document.querySelector('#untrusted-frame').contentWindow.location.href`,
      ),
    )
    .toBe("about:blank");
  expect(
    await content(
      `${fixture.url}/`,
      "[typeof window.qa, typeof require, typeof process]",
    ),
  ).toEqual(["undefined", "undefined", "undefined"]);
  expect(
    await content(`${fixture.url}/`, "Notification.requestPermission()"),
  ).toBe("denied");
  await expect(
    command({ type: "navigate", url: "talos://app/index.html" }),
  ).rejects.toThrow(/HTTP/);
});

test("a second process cannot open the same profile and popup creation is bounded", async () => {
  const executable = await app.evaluate(() => process.execPath);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  await promisify(execFile)(executable, [".", `--qa-user-data=${dataDir}`], {
    env,
    timeout: 15000,
  });
  expect((await state()).accounts).toHaveLength(3);
  await command({ type: "navigate", url: fixture.url });
  await ready(`${fixture.url}/`);
  await content(
    `${fixture.url}/`,
    "for(let i=0;i<12;i++) window.open('/popup?limit='+i, '_blank'); true",
  );
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
    )
    .toBe(9);
  const workspace = await state();
  const accountId = workspace.tabs.find(
    (tab: any) => tab.id === workspace.activeTabId,
  )?.accountId;
  await command({ type: "reset-account", accountId });
  expect(
    await app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
    ),
  ).toBe(1);
});

test("reset fails before touching the session when recovery state cannot be saved", async () => {
  await command({
    type: "create-account",
    name: "Save failure",
    color: "#177e69",
    persistent: true,
    url: fixture.url,
  });
  const before = await state();
  const account = before.accounts.find(
    (account: any) => account.name === "Save failure",
  );
  await ready(`${fixture.url}/`);
  await content(`${fixture.url}/`, "fixture.seed('preserve-on-save-failure')");
  const { rm } = await import("node:fs/promises");
  const blockedWrite = path.join(dataDir, "workspace.json.tmp");
  await mkdir(blockedWrite);
  try {
    await expect(
      command({ type: "reset-account", accountId: account.id }),
    ).rejects.toThrow(/reset recovery state/);
    const after = await state();
    expect(after.activeTabId).toBe(before.activeTabId);
    expect(
      after.accounts.find((item: any) => item.id === account.id).resetting,
    ).toBe(false);
    expect(
      await content(`${fixture.url}/`, "localStorage.getItem('identity')"),
    ).toBe("preserve-on-save-failure");
  } finally {
    await rm(blockedWrite, { recursive: true });
  }
  await command({ type: "reset-account", accountId: account.id });
  await ready(`${fixture.url}/`);
  expect(
    await content(`${fixture.url}/`, "localStorage.getItem('identity')"),
  ).toBe(null);
});

test("appearance settings preview, persistence, defaults and website styling", async () => {
  const defaults = {
    background: "#000000",
    text: "#ffffff",
    accent: "#83dab7",
  };
  expect((await state()).appearance).toEqual(defaults);
  const groupBounds = await shell.locator("#accounts").boundingBox();
  for (const card of await shell.locator(".account-card").all()) {
    const bounds = (await card.boundingBox())!;
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(32);
  }
  const plusBounds = await shell
    .getByRole("button", { name: "New account group", exact: true })
    .boundingBox();
  expect(
    plusBounds!.x - (groupBounds!.x + groupBounds!.width),
  ).toBeLessThanOrEqual(16);
  expect(await shell.locator("#new-account").textContent()).not.toContain(
    "New group",
  );
  const url = `${fixture.url}/?identity=appearance`;
  await command({ type: "navigate", url });
  await ready(url);
  await content(url, "fixture.seed('appearance')");
  const websiteStyle = await content(
    url,
    "JSON.stringify({background:getComputedStyle(document.body).backgroundColor, color:getComputedStyle(document.body).color, styles:document.querySelectorAll('style').length})",
  );
  const visibleGuests = () =>
    app.evaluate(
      ({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].contentView.children.filter((view) =>
          view.getVisible(),
        ).length,
    );
  expect(await visibleGuests()).toBe(1);
  await shell.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    shell.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  expect(await visibleGuests()).toBe(0);
  await shell.screenshot({ path: "artifacts/talos-settings.png" });
  const custom = { background: "#f5f5f5", text: "#181818", accent: "#523ac7" };
  for (const [key, value] of Object.entries(custom))
    await shell.locator(`#hex-${key}`).fill(value);
  await expect(shell.locator("#appearance-status")).toHaveText(
    "Unsaved changes",
  );
  expect(
    await shell.evaluate(
      () => getComputedStyle(document.documentElement).colorScheme,
    ),
  ).toBe("light");
  expect((await state()).appearance).toEqual(defaults);
  await shell.getByRole("button", { name: "Back to browsing" }).click();
  await expect(shell.locator("#settings-page")).toBeHidden();
  expect(await visibleGuests()).toBe(1);
  expect(
    await shell.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--background")
        .trim(),
    ),
  ).toBe(defaults.background);
  await shell.getByRole("button", { name: "Settings", exact: true }).click();
  for (const [key, value] of Object.entries(custom))
    await shell.locator(`#hex-${key}`).fill(value);
  await shell.getByRole("button", { name: "Save changes" }).click();
  await expect(shell.locator("#appearance-status")).toHaveText("Colours saved");
  expect((await state()).appearance).toEqual(custom);
  await shell.screenshot({ path: "artifacts/talos-settings-light.png" });
  await expect(
    command({
      type: "appearance",
      appearance: { ...custom, accent: "url(https://example.com)" },
    }),
  ).rejects.toThrow(/hex colour/);
  await shell.getByRole("button", { name: "Back to browsing" }).click();
  expect(
    await content(
      url,
      "JSON.stringify({background:getComputedStyle(document.body).backgroundColor, color:getComputedStyle(document.body).color, styles:document.querySelectorAll('style').length})",
    ),
  ).toBe(websiteStyle);
  expect(await content(url, "fixture.read()")).toMatchObject({
    local: "appearance",
  });
  await command({
    type: "reset-account",
    accountId: (await state()).accounts[0].id,
  });
  expect((await state()).appearance).toEqual(custom);
  await app.close();
  await launch();
  expect((await state()).appearance).toEqual(custom);
  // Settings also work through the native browser menu.
  await app.evaluate(({ Menu, BrowserWindow }) => {
    const item = Menu.getApplicationMenu()!
      .items.find((item) => item.label === "File")!
      .submenu!.items.find((item) => item.label === "Settings")!;
    item.click(item, BrowserWindow.getAllWindows()[0], {} as any);
  });
  await expect(shell.locator("#settings-page")).toBeVisible();
  for (const [key, value] of Object.entries(custom))
    await expect(shell.locator(`#hex-${key}`)).toHaveValue(value);
  await shell.getByRole("button", { name: "Reset to defaults" }).click();
  expect((await state()).appearance).toEqual(custom);
  await shell.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(async () => (await state()).appearance).toEqual(defaults);
  await shell.keyboard.press("Escape");
  await expect(shell.locator("#settings-page")).toBeHidden();
  await shell.screenshot({ path: "artifacts/talos-workspace.png" });
  await app.close();
  await launch();
  expect((await state()).appearance).toEqual(defaults);
});
test("isolation, shared tabs, inboxes, popup session and reset", async () => {
  const initial = await state();
  const investor = initial.accounts[0];
  const adviser = initial.accounts[1];
  const investorURL = `${fixture.url}/?identity=investor`;
  const adviserURL = `${fixture.url}/?identity=adviser`;
  await command({ type: "navigate", url: investorURL });
  await ready(investorURL);
  const stored = await content(investorURL, "fixture.seed('investor')");
  expect(stored).toMatchObject({
    local: "investor",
    indexed: "investor",
    cache: "investor",
    workers: 1,
    node: "undefined",
    bridge: "undefined",
  });
  await command({ type: "activate-tab", tabId: initial.tabs[1].id });
  await command({ type: "navigate", url: adviserURL });
  await ready(adviserURL);
  expect(await content(adviserURL, "fixture.read()")).toMatchObject({
    cookie: "",
    local: null,
    indexed: null,
    cache: null,
    workers: 0,
  });
  await content(adviserURL, "fixture.seed('adviser')");
  expect(await content(investorURL, "fixture.read()")).toMatchObject({
    local: "investor",
    indexed: "investor",
    cache: "investor",
  });
  const investorCache = await content(
    investorURL,
    "fetch('/cached').then(r=>r.text())",
  );
  const adviserCache = await content(
    adviserURL,
    "fetch('/cached').then(r=>r.text())",
  );
  expect(investorCache).not.toBe(adviserCache);
  expect(await content(investorURL, "fetch('/cached').then(r=>r.text())")).toBe(
    investorCache,
  );
  const sharedURL = `${fixture.url}/?identity=shared`;
  await command({ type: "new-tab", accountId: investor.id, url: sharedURL });
  await ready(sharedURL);
  expect(await content(sharedURL, "fixture.read()")).toMatchObject({
    local: "investor",
    indexed: "investor",
    cache: "investor",
    session: null,
  });
  await content(sharedURL, "fixture.seed('updated')");
  expect(await content(investorURL, "fixture.read()")).toMatchObject({
    local: "updated",
    indexed: "updated",
  });
  // The website's window.open uses the same session and keeps window.opener for login flows.
  await content(
    sharedURL,
    "window.open('/popup','auth','width=600,height=500'); true",
  );
  const popupURL = `${fixture.url}/popup`;
  await ready(popupURL);
  expect(await content(popupURL, "fixture.read()")).toMatchObject({
    local: "updated",
    cache: "updated",
    node: "undefined",
    bridge: "undefined",
  });
  expect(await content(popupURL, "!!window.opener")).toBe(true);
  const inboxURL = `${fixture.url}/inbox`;
  await command({
    type: "new-tab",
    accountId: investor.id,
    url: inboxURL,
    kind: "inbox",
  });
  await ready(inboxURL);
  expect(
    (await state()).tabs.find((tab: any) => tab.url === inboxURL).kind,
  ).toBe("inbox");
  expect(await content(inboxURL, "fixture.read()")).toMatchObject({
    local: "updated",
  });
  await command({ type: "reset-account", accountId: investor.id });
  await ready(investorURL);
  await ready(sharedURL);
  await ready(inboxURL);
  expect(await content(investorURL, "fixture.read()")).toMatchObject({
    cookie: "",
    local: null,
    session: null,
    indexed: null,
    cache: null,
    workers: 0,
  });
  expect(await content(sharedURL, "fixture.read()")).toMatchObject({
    local: null,
  });
  expect(await content(adviserURL, "fixture.read()")).toMatchObject({
    local: "adviser",
    indexed: "adviser",
    cache: "adviser",
    workers: 1,
  });
  expect(
    await content(investorURL, "fetch('/cached').then(r=>r.text())"),
  ).not.toBe(investorCache);
  expect(
    await app.evaluate(
      ({ webContents }, url) =>
        webContents.getAllWebContents().some((wc) => wc.getURL() === url),
      popupURL,
    ),
  ).toBe(false);
  // Opening DevTools belongs to the selected guest.
  await command({ type: "devtools" });
  await expect
    .poll(() =>
      app.evaluate(
        ({ webContents }, url) =>
          webContents
            .getAllWebContents()
            .find((wc) => wc.getURL() === url)
            ?.isDevToolsOpened(),
        inboxURL,
      ),
    )
    .toBe(true);
});

test("locator picker captures elements without clicking them and copies Playwright locators", async () => {
  const firstURL = `${fixture.url}/`;
  await command({ type: "navigate", url: firstURL });
  await ready(firstURL);
  await command({ type: "locator-pick" });
  expect((await state()).locator.picking).toBe(true);
  expect(
    (await shell.evaluate(() => (window as any).qa.automation())).enabled,
  ).toBe(false);
  await command({ type: "locator-cancel" });
  expect((await state()).locator.picking).toBe(false);
  await app.close();
  await launch(["--qa-automation"]);
  const initial = await state();
  const owner = initial.accounts[0];
  const url = `${fixture.url}/?locators`;
  await command({ type: "navigate", url });
  await ready(url);
  await content(
    url,
    `
    document.body.innerHTML = '<main style="margin:20px"><button id="test-id" data-testid="save-button">Save</button><button id="role-pick">Unique action</button><button data-testid="repeated" id="first-duplicate">Duplicate</button><button data-testid="repeated" id="second-duplicate">Duplicate</button><div id="shadow-host"></div><iframe id="test-frame" title="Inner form"></iframe></main>';
    window.locatorClicks = 0;
    document.querySelectorAll('button').forEach(button => button.onclick = () => window.locatorClicks++);
    document.querySelector('#shadow-host').attachShadow({mode:'open'}).innerHTML='<button data-testid="shadow-button">Shadow button</button>';
    document.querySelector('iframe').srcdoc='<button id="inner-button" data-testid="inner-button">Frame button</button>';
    true
  `,
  );
  await command({ type: "tools", open: true });
  const sections = shell.getByRole("navigation", { name: "QA tools sections" });
  await expect(sections.getByRole("button")).toHaveText([
    "Locator picker",
    "API tester",
    "Playwright",
  ]);
  await expect(
    sections.getByRole("button", { name: "Network", exact: true }),
  ).toHaveCount(0);
  await expect(
    sections.getByRole("button", { name: "Console", exact: true }),
  ).toHaveCount(0);
  await expect(
    sections.getByRole("button", { name: "DevTools", exact: true }),
  ).toHaveCount(0);
  const pick = async (expression: string) => {
    const position = await content(
      url,
      `(() => { const el = ${expression}; const rect = el.getBoundingClientRect(); const frame = el.ownerDocument.defaultView.frameElement; const offset = frame?.getBoundingClientRect(); return { x:rect.x+rect.width/2+(offset?.x||0)+(frame?.clientLeft||0), y:rect.y+rect.height/2+(offset?.y||0)+(frame?.clientTop||0) }; })()`,
    );
    await shell
      .getByRole("button", { name: "Pick an element", exact: true })
      .click();
    await expect.poll(async () => (await state()).locator.picking).toBe(true);
    await app.evaluate(
      async ({ webContents }, { url, position }) => {
        const wc = webContents
          .getAllWebContents()
          .find((wc) => wc.getURL() === url)!;
        wc.sendInputEvent({
          type: "mouseMove",
          x: Math.round(position.x),
          y: Math.round(position.y),
        });
        await new Promise((resolve) => setTimeout(resolve, 80));
        wc.sendInputEvent({
          type: "mouseDown",
          button: "left",
          clickCount: 1,
          x: Math.round(position.x),
          y: Math.round(position.y),
        });
        wc.sendInputEvent({
          type: "mouseUp",
          button: "left",
          clickCount: 1,
          x: Math.round(position.x),
          y: Math.round(position.y),
        });
      },
      { url, position },
    );
    await expect.poll(async () => (await state()).locator.picking).toBe(false);
    const status = (await state()).locator;
    expect(status.error).toBeUndefined();
    expect(status.result).toBeTruthy();
    return status.result;
  };
  const testId = await pick("document.querySelector('#test-id')");
  expect(testId.code).toBe('page.getByTestId("save-button")');
  expect(await content(url, "window.locatorClicks")).toBe(0);
  await shell
    .getByRole("button", { name: "Copy locator", exact: true })
    .click();
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(
    testId.code,
  );
  const role = await pick("document.querySelector('#role-pick')");
  expect(role.code).toBe(
    'page.getByRole("button", { name: "Unique action", exact: true })',
  );
  const duplicate = await pick("document.querySelector('#second-duplicate')");
  expect(duplicate.code).toBe('page.locator("#second-duplicate")');
  const shadow = await pick(
    "document.querySelector('#shadow-host').shadowRoot.querySelector('button')",
  );
  expect(shadow.code).toBe('page.getByTestId("shadow-button")');
  const inner = await pick(
    "document.querySelector('iframe').contentDocument.querySelector('button')",
  );
  expect(inner.code).toBe(
    'page.frameLocator("#test-frame").getByTestId("inner-button")',
  );
  await expect
    .poll(
      async () =>
        (await shell.evaluate(() => (window as any).qa.automation())).endpoint,
    )
    .toBeTruthy();
  const automation = await shell.evaluate(() =>
    (window as any).qa.automation(),
  );
  const talos = await connectTalos(chromium, automation.endpoint);
  try {
    const group = await talos.group(owner.id);
    const page = group.websites[0];
    for (const result of [testId, role, duplicate, shadow, inner]) {
      const locator = new Function("page", `return ${result.code}`)(page);
      await expect(locator).toHaveCount(1);
      expect(await locator.evaluate((el: Element) => el.localName)).toBe(
        result.tag,
      );
    }
  } finally {
    await talos.disconnect();
  }
  await shell.screenshot({ path: "artifacts/talos-locator-picker.png" });
  await shell.locator("#qa-drawer").screenshot({
    path: "artifacts/talos-locator-panel.png",
  });
  await shell
    .getByRole("button", { name: "Pick an element", exact: true })
    .click();
  await shell
    .getByRole("button", { name: "Cancel picking", exact: true })
    .click();
  expect((await state()).locator.picking).toBe(false);
  await command({ type: "locator-pick" });
  await app.evaluate(({ webContents }, url) => {
    const wc = webContents
      .getAllWebContents()
      .find((wc) => wc.getURL() === url)!;
    wc.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    wc.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
  }, url);
  await expect.poll(async () => (await state()).locator.picking).toBe(false);
  await command({ type: "locator-pick" });
  await command({ type: "activate-tab", tabId: initial.tabs[1].id });
  expect((await state()).locator.picking).toBe(false);
  await expect(shell.locator("#locator-code")).toHaveCount(0);
  await expect(command({ type: "locator-copy" })).rejects.toThrow(
    /Pick an element/,
  );
  await command({ type: "activate-tab", tabId: initial.tabs[0].id });
  await command({ type: "locator-pick" });
  await command({ type: "navigate", url: `${fixture.url}/?other-page` });
  await ready(`${fixture.url}/?other-page`);
  expect((await state()).locator.picking).toBe(false);
  await command({ type: "devtools" });
  await expect
    .poll(() =>
      app.evaluate(
        ({ webContents }, url) =>
          webContents
            .getAllWebContents()
            .find((wc) => wc.getURL() === url)
            ?.isDevToolsOpened(),
        `${fixture.url}/?other-page`,
      ),
    )
    .toBe(true);
  await expect(command({ type: "locator-pick" })).rejects.toThrow(
    /Close this tab’s DevTools/,
  );
});
test("saved groups and inboxes return after restart; temporary data does not", async () => {
  const tempURL = `${fixture.url}/temporary`;
  await command({ type: "navigate", url: tempURL });
  await ready(tempURL);
  await content(tempURL, "fixture.seed('temporary')");
  await command({
    type: "create-account",
    name: "Saved identity",
    color: "#177e69",
    persistent: true,
    url: `${fixture.url}/saved?token=never-save-me#secret`,
    inboxURL: `${fixture.url}/inbox`,
  });
  const firstState = await state();
  const saved = firstState.accounts.find(
    (account: any) => account.name === "Saved identity",
  );
  const savedURL = `${fixture.url}/saved?token=never-save-me#secret`;
  await ready(savedURL);
  await content(savedURL, "fixture.seed('saved')");
  await app.evaluate(async ({ session }, partition) => {
    const ses = session.fromPartition(partition);
    await ses.cookies.flushStore();
    ses.flushStorageData();
  }, `persist:qa-${saved.id}`);
  await app.close();
  await launch();
  const restored = await state();
  expect(restored.accounts).toHaveLength(1);
  expect(restored.accounts[0]).toMatchObject({
    name: "Saved identity",
    persistent: true,
    id: saved.id,
  });
  expect(restored.tabs.map((tab: any) => tab.url).sort()).toEqual([
    `${fixture.url}/inbox`,
    `${fixture.url}/saved`,
  ]);
  expect(restored.tabs.find((tab: any) => tab.kind === "inbox")).toBeTruthy();
  await ready(`${fixture.url}/saved`);
  expect(await content(`${fixture.url}/saved`, "fixture.read()")).toMatchObject(
    { local: "saved", indexed: "saved", cache: "saved", workers: 1 },
  );
  await command({
    type: "create-account",
    name: "Fresh identity",
    color: "#6378ca",
    persistent: false,
    url: tempURL,
  });
  await ready(tempURL);
  expect(await content(tempURL, "fixture.read()")).toMatchObject({
    local: null,
    cookie: "",
    indexed: null,
    cache: null,
  });
  await command({ type: "remove-account", accountId: saved.id });
  await command({
    type: "create-account",
    name: "Another saved identity",
    color: "#177e69",
    persistent: true,
    url: `${fixture.url}/saved`,
  });
  await ready(`${fixture.url}/saved`);
  expect(await content(`${fixture.url}/saved`, "fixture.read()")).toMatchObject(
    { local: null, cookie: "", indexed: null, cache: null },
  );
});
test("group and inbox UI, error handling and remote navigation protections", async () => {
  await expect(
    shell.getByRole("heading", { name: "Every role. One workspace." }),
  ).toBeVisible();
  await shell.getByRole("button", { name: /New account group/ }).click();
  await shell.getByLabel("Group name", { exact: true }).fill("Lawyer");
  await shell.getByLabel(/Starting website/).fill(fixture.url);
  await shell.getByLabel(/Email inbox address/).fill(`${fixture.url}/inbox`);
  await shell.getByRole("button", { name: "Create group" }).click();
  await expect(shell.getByRole("dialog")).not.toBeVisible();
  await ready(`${fixture.url}/`);
  await ready(`${fixture.url}/inbox`);
  await expect(
    shell.getByRole("tab", { name: "Inbox · Demo inbox" }),
  ).toBeVisible();
  await shell.getByRole("button", { name: "Manage Lawyer" }).click();
  await shell.getByLabel("Group name", { exact: true }).fill("Lawyer 2");
  await shell.getByRole("button", { name: "Save name" }).click();
  await expect(
    shell.getByRole("button", { name: "Manage Lawyer 2" }),
  ).toBeVisible();
  await expect(
    command({ type: "navigate", url: "file:///C:/Windows/win.ini" }),
  ).rejects.toThrow(/HTTP or HTTPS/);
  await expect(
    command({ type: "navigate", url: "javascript:alert(1)" }),
  ).rejects.toThrow(/HTTP or HTTPS/);
  await content(
    `${fixture.url}/`,
    "window.open('file:///C:/Windows/win.ini'); true",
  );
  expect(
    await app.evaluate(({ webContents }) =>
      webContents
        .getAllWebContents()
        .some((wc) => wc.getURL().includes("win.ini")),
    ),
  ).toBe(false);
  // A broken target produces a recoverable shell error without leaking IPC into remote content.
  await command({ type: "navigate", url: "http://127.0.0.1:1" });
  await expect(shell.getByText("Let’s try that again.")).toBeVisible();
  await command({ type: "navigate", url: "" });
  await expect(
    shell.getByRole("heading", { name: "Every role. One workspace." }),
  ).toBeVisible();
  await mkdir("artifacts", { recursive: true });
  await expect
    .poll(async () => {
      const s = await state();
      const active = s.tabs.find((tab: any) => tab.id === s.activeTabId);
      return active.title === "New tab" && !active.loading;
    })
    .toBe(true);
  await shell.screenshot({ path: "artifacts/talos-workspace.png" });
  await shell
    .getByRole("button", { name: "Reset session", exact: true })
    .click();
  await shell
    .getByRole("dialog")
    .getByRole("button", { name: "Reset session", exact: true })
    .click();
  await expect(shell.getByRole("dialog")).not.toBeVisible();
});
test("compact group tabs preserve selection and address-bar search displays a page", async () => {
  const initial = await state();
  const investor = initial.accounts[0];
  const adviser = initial.accounts[1];
  await shell
    .getByRole("button", { name: "New shared tab", exact: true })
    .click();
  const website = `${fixture.url}/?second-tab`;
  await shell.getByLabel("Website address").fill(website);
  await shell.getByLabel("Website address").press("Enter");
  await ready(website);
  const secondTab = (await state()).activeTabId;
  await expect(shell.getByRole("tab")).toHaveCount(2);
  await shell.getByRole("button", { name: /^Adviser/ }).click();
  await expect
    .poll(async () => (await state()).activeTabId)
    .toBe(initial.tabs.find((t: any) => t.accountId === adviser.id).id);
  await expect(shell.getByRole("tab")).toHaveCount(1);
  await shell.getByRole("button", { name: /^Investor/ }).click();
  await expect.poll(async () => (await state()).activeTabId).toBe(secondTab);
  await expect(shell.getByRole("tab")).toHaveCount(2);
  for (const expectedTab of [
    initial.tabs.find((t: any) => t.accountId === investor.id).id,
    secondTab,
  ]) {
    await app.evaluate(({ Menu }) => {
      const page = Menu.getApplicationMenu()!.items.find(
        (item) => item.label === "Page",
      )!;
      const next = page.submenu!.items.find(
        (item) => item.label === "Next tab",
      )!;
      (next as any).click();
    });
    await expect
      .poll(async () => (await state()).activeTabId)
      .toBe(expectedTab);
  }
  await expect(
    shell.getByRole("button", { name: /Attach email inbox/ }),
  ).toHaveCount(0);
  const bounds = await app.evaluate(({ BrowserWindow }, url) => {
    const host = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().endsWith("/index.html"),
    )!;
    const view = host.contentView.children.find(
      (view: any) => view.webContents?.getURL() === url,
    )!;
    return {
      bounds: view.getBounds(),
      width: host.getContentSize()[0],
      visible: view.getVisible(),
    };
  }, website);
  expect(bounds.bounds.x).toBe(0);
  expect(bounds.visible).toBe(true);
  expect(bounds.bounds.width).toBe(bounds.width);
  const header = await shell.locator("header").boundingBox();
  expect(bounds.bounds.y).toBe(header!.height);
  // Use a local redirect to prove UI search submission and guest rendering without internet availability.
  await app.evaluate(
    ({ webContents }, { website, fixtureURL }) => {
      const guest = webContents
        .getAllWebContents()
        .find((w) => w.getURL() === website)!;
      guest.session.webRequest.onBeforeRequest(
        { urls: ["https://duckduckgo.com/*"] },
        (details, callback) => {
          const query = new URL(details.url).searchParams.get("q")!;
          callback({
            redirectURL: `${fixtureURL}/search?q=${encodeURIComponent(query)}`,
          });
        },
      );
    },
    { website, fixtureURL: fixture.url },
  );
  for (const query of ["qa designers", "site:example.com login"]) {
    await shell.getByLabel("Website address").fill(query);
    await shell.getByLabel("Website address").press("Enter");
    const resultURL = `${fixture.url}/search?q=${encodeURIComponent(query)}`;
    await ready(resultURL);
    await expect
      .poll(async () => {
        const s = await state();
        const active = s.tabs.find((t: any) => t.id === s.activeTabId);
        return {
          url: active.url,
          loading: active.loading,
          error: active.error || "",
        };
      })
      .toEqual({ url: resultURL, loading: false, error: "" });
    expect(await content(resultURL, "document.body.innerText")).toContain(
      "Who’s signed in?",
    );
  }
});

test("failed cleanup blocks the group across restart until reset succeeds", async () => {
  await command({
    type: "create-account",
    name: "Reset recovery",
    color: "#177e69",
    persistent: true,
    url: fixture.url,
  });
  await ready(`${fixture.url}/`);
  const account = (await state()).accounts.find(
    (item: any) => item.name === "Reset recovery",
  );
  await content(`${fixture.url}/`, "fixture.seed('must-be-cleared')");
  await app.evaluate(({ session }, partition) => {
    const ses = session.fromPartition(partition);
    ses.clearStorageData = async () => {
      throw new Error("Simulated disk failure");
    };
  }, `persist:qa-${account.id}`);
  await expect(
    command({ type: "reset-account", accountId: account.id }),
  ).rejects.toThrow(/cleanup failed/);
  expect(
    (await state()).accounts.find((item: any) => item.id === account.id)
      .resetting,
  ).toBe(true);
  await expect(
    command({ type: "new-tab", accountId: account.id, url: fixture.url }),
  ).rejects.toThrow(/being reset/);
  await app.close();
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    chromiumSandbox: true,
    args: [".", `--qa-user-data=${dataDir}`],
    env,
  });
  await expect
    .poll(() =>
      app.windows().some((page) => page.url().endsWith("/index.html")),
    )
    .toBe(true);
  shell = app.windows().find((page) => page.url().endsWith("/index.html"))!;
  await shell.waitForFunction(() => !!(window as any).qa);
  expect((await state()).accounts[0].resetting).toBe(true);
  expect((await state()).tabs).toHaveLength(0);
  await command({ type: "reset-account", accountId: account.id });
  expect((await state()).accounts[0].resetting).toBe(false);
  await command({ type: "navigate", url: fixture.url });
  await ready(`${fixture.url}/`);
  expect(await content(`${fixture.url}/`, "fixture.read()")).toMatchObject({
    cookie: "",
    local: null,
    indexed: null,
    cache: null,
    workers: 0,
  });
});
test("authenticated API requests and browser conventions", async () => {
  const initial = await state();
  const owner = initial.accounts[0];
  const website = `${fixture.url}/`;
  await command({ type: "navigate", url: website });
  await ready(website);
  await content(website, "fixture.seed('qa-user')");
  const send = (request: object) =>
    shell.evaluate((request) => (window as any).qa.request(request), request);
  const request = {
    accountId: owner.id,
    url: `${fixture.url}/api/echo?token=secret-query`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer secret-auth",
    },
    body: '{"qa":true}',
    useSession: true,
  };
  const response = await send(request);
  expect(response.status).toBe(200);
  expect(JSON.parse(response.body)).toMatchObject({
    method: "POST",
    cookie: "identity=qa-user",
    body: '{"qa":true}',
    authorization: "Bearer secret-auth",
  });
  const fresh = await send({ ...request, useSession: false });
  expect(JSON.parse(fresh.body).cookie).toBe("");
  const redirected = await send({
    ...request,
    url: `${fixture.url}/api/redirect`,
    method: "GET",
    body: "",
  });
  expect(redirected.status).toBe(302);
  const large = await send({
    ...request,
    url: `${fixture.url}/api/large`,
    method: "GET",
    body: "",
  });
  expect(large.truncated).toBe(true);
  expect(large.bytes).toBe(2 * 1024 * 1024);
  await expect(
    send({ ...request, url: "file:///C:/Windows/win.ini" }),
  ).rejects.toThrow(/HTTP or HTTPS/);
  await expect(
    send({ ...request, headers: { Host: "bad.test" } }),
  ).rejects.toThrow(/reserved header/);
  await shell.getByRole("button", { name: "QA tools", exact: true }).click();
  await expect(
    shell.getByRole("region", { name: "QA workspace" }),
  ).toBeVisible();
  await shell.getByRole("button", { name: "API tester", exact: true }).click();
  await shell.getByLabel("API request URL").fill(`${fixture.url}/api/echo`);
  await shell.getByLabel("HTTP method").selectOption("POST");
  await shell
    .getByLabel("Request headers")
    .fill('{"Content-Type":"application/json"}');
  await shell.getByLabel("Request body", { exact: true }).fill('{"from":"ui"}');
  await shell.getByRole("button", { name: "Send request" }).click();
  await expect(shell.locator(".response-body")).toContainText("qa-user");
  await expect(shell.locator(".response-body")).toContainText("ui");
  await command({ type: "zoom", direction: "in" });
  expect(
    await app.evaluate(
      ({ webContents }, url) =>
        webContents
          .getAllWebContents()
          .find((wc) => wc.getURL() === url)!
          .getZoomFactor(),
      website,
    ),
  ).toBeGreaterThan(1);
  await command({ type: "zoom", direction: "reset" });
  await command({ type: "find", text: "signed" });
  await expect(shell.locator("#find-count")).toContainText("/1");
  await command({ type: "stop-find" });
  await command({ type: "duplicate-tab", tabId: initial.tabs[0].id });
  expect(
    (await state()).tabs.filter((tab: any) => tab.accountId === owner.id),
  ).toHaveLength(2);
  const duplicate = (await state()).activeTabId;
  await command({ type: "close-tab", tabId: duplicate });
  await command({ type: "reopen-tab" });
  const reopened = (await state()).activeTabId;
  expect(
    (await state()).tabs.filter((tab: any) => tab.accountId === owner.id),
  ).toHaveLength(2);
  await command({
    type: "reorder-tab",
    tabId: reopened,
    beforeTabId: initial.tabs[0].id,
  });
  expect((await state()).tabs[0].id).toBe(reopened);
  await command({ type: "navigate", url: "" });
  await expect
    .poll(async () => {
      const s = await state();
      const tab = s.tabs.find((tab: any) => tab.id === s.activeTabId);
      return tab.url === "about:blank" && !tab.loading;
    })
    .toBe(true);
  await expect(
    shell.getByRole("heading", { name: "Every role. One workspace." }),
  ).toBeVisible();
  await expect(
    shell.getByRole("button", { name: "Send request" }),
  ).toBeEnabled();
  await mkdir("artifacts", { recursive: true });
  await shell.screenshot({ path: "artifacts/talos-qa-workspace.png" });
});
test("Playwright adapter connects to live group tabs and preserves their sessions", async () => {
  expect(
    (await shell.evaluate(() => (window as any).qa.automation())).enabled,
  ).toBe(false);
  await app.close();
  await launch(["--qa-automation"]);
  await expect
    .poll(
      async () =>
        (await shell.evaluate(() => (window as any).qa.automation())).endpoint,
    )
    .toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  const info = await shell.evaluate(() => (window as any).qa.automation());
  const initial = await state();
  const owner = initial.accounts[0];
  const website = `${fixture.url}/`;
  await command({ type: "navigate", url: website });
  await ready(website);
  await content(website, "fixture.seed('automation-user')");
  await command({
    type: "new-tab",
    accountId: owner.id,
    url: `${fixture.url}/inbox`,
    kind: "inbox",
  });
  await ready(`${fixture.url}/inbox`);
  await expect
    .poll(
      async () =>
        (await state()).tabs.filter(
          (tab: any) => tab.accountId === owner.id && tab.automationTargetId,
        ).length,
    )
    .toBe(2);
  const talos = await connectTalos(chromium, info.endpoint);
  try {
    const groups = await talos.groups();
    expect(groups.some((group: any) => group.name === "Investor")).toBe(true);
    const investor = await talos.group("Investor");
    expect(investor.websites).toHaveLength(1);
    expect(investor.inboxes).toHaveLength(1);
    expect(
      await investor.websites[0].evaluate(() =>
        localStorage.getItem("identity"),
      ),
    ).toBe("automation-user");
    await investor.websites[0]
      .getByLabel("Demo identity")
      .fill("playwright-user");
    await investor.websites[0]
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await expect
      .poll(() => content(website, "localStorage.getItem('identity')"))
      .toBe("playwright-user");
    const adviser = await talos.group(initial.accounts[1].id);
    await adviser.websites[0].goto(`${fixture.url}/adviser`);
    expect(
      await adviser.websites[0].evaluate(() =>
        localStorage.getItem("identity"),
      ),
    ).toBeNull();
  } finally {
    await talos.disconnect();
  }
  // Disconnecting the adapter leaves the app and its live sessions running.
  expect((await state()).accounts).toHaveLength(3);
});
test("reset aborts an active API request before clearing its session", async () => {
  const owner = (await state()).accounts[0];
  let slowStarted = false;
  fixture.server.on("request", (request: any) => {
    if (request.url.startsWith("/api/slow")) slowStarted = true;
  });
  const pending = shell
    .evaluate((request) => (window as any).qa.request(request), {
      accountId: owner.id,
      url: `${fixture.url}/api/slow`,
      method: "GET",
      headers: {},
      body: "",
      useSession: true,
    })
    .then(
      () => "completed",
      (error) => String(error),
    );
  await expect.poll(() => slowStarted).toBe(true);
  await command({ type: "reset-account", accountId: owner.id });
  expect(await pending).toContain("cancelled");
  expect(
    (await state()).accounts.find((account: any) => account.id === owner.id)
      .resetting,
  ).toBe(false);
});
