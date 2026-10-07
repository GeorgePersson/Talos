import {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  Menu,
  session,
  dialog,
  clipboard,
  protocol,
} from "electron";
import type {
  Session,
  WebContents,
  IpcMainInvokeEvent,
  DownloadItem,
} from "electron";
import { randomUUID } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  statSync,
  openSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  COLORS,
  CHROME_HEIGHT,
  FOOTER_HEIGHT,
  DEFAULT_APPEARANCE,
  type AccountInfo,
  type TabInfo,
  type WorkspaceState,
} from "./shared";
import { parseAppearance } from "./preferences";
import { normalizeURL, addressURL, isWebURL, savedURL } from "./url";
import {
  registerRequestGroup,
  sendRequest,
  stopRequests,
  forgetRequestGroup,
} from "./qa";
import { LocatorPicker } from "./locator";
import {
  configureAutomation,
  automationEnabled,
  automationEndpoint,
  targetId,
} from "./automation";

interface Account extends AccountInfo {
  partition: string;
  session: Session;
  popups: Set<BrowserWindow>;
  downloads: Set<DownloadItem>;
}
interface Tab {
  info: TabInfo;
  view: WebContentsView;
  pendingURL?: string;
}
interface SavedAccount {
  id: string;
  name: string;
  color: string;
  blocked?: boolean;
  urls?: string[];
  pages?: { url: string; kind: "web" | "inbox" }[];
}
let window: BrowserWindow;
let activeTabId = "";
let overlayOpen = false;
let settingsOpen = false;
let appearance = { ...DEFAULT_APPEARANCE };
let quitting = false;
let initialized = false;
let toolsOpen = false;
let devtoolsMode: "right" | "bottom" | "detach" = "right";
const accounts = new Map<string, Account>();
const tabs = new Map<string, Tab>();
const locatorPicker = new LocatorPicker(emit);
const resetInFlight = new Set<string>();
const closedTabs: { accountId: string; url: string; kind: "web" | "inbox" }[] =
  [];
function rememberTab(tab: Tab) {
  closedTabs.push({
    accountId: tab.info.accountId,
    url: tab.info.url,
    kind: tab.info.kind,
  });
  if (closedTabs.length > 50) closedTabs.shift();
}
const shellURL = "talos://app/index.html";
protocol.registerSchemesAsPrivileged([
  { scheme: "talos", privileges: { standard: true, secure: true } },
]);
const dataArg = process.argv.find((value) =>
  value.startsWith("--qa-user-data="),
);
if (dataArg)
  app.setPath(
    "userData",
    path.resolve(dataArg.slice("--qa-user-data=".length)),
  );
app.setName("Talos");
// Chromium profiles and atomic workspace writes must have one owner.
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on("second-instance", () => {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
});
// Some AppImage launchers silently add this flag when user namespaces fail.
// Remote websites must never run with the Chromium sandbox disabled.
if (app.commandLine.hasSwitch("no-sandbox")) {
  dialog.showErrorBox(
    "Talos requires the Chromium sandbox",
    "Launch Talos without --no-sandbox. On Linux, check user namespace support and the sandbox setup in LINUX.md. The portable archive is an alternative to AppImage launchers that add this flag.",
  );
  app.exit(1);
}
app.enableSandbox();
configureAutomation();

function state(): WorkspaceState {
  return {
    accounts: [...accounts.values()].map(
      ({ id, name, color, persistent, resetting }) => ({
        id,
        name,
        color,
        persistent,
        resetting,
      }),
    ),
    tabs: [...tabs.values()].map((tab) => ({ ...tab.info })),
    activeTabId,
    toolsOpen,
    settingsOpen,
    appearance: { ...appearance },
    locator: locatorPicker.state(),
  };
}
function save(required = false) {
  if (!initialized) return;
  const saved = [...accounts.values()]
    .filter((account) => account.persistent)
    .map((account) => ({
      id: account.id,
      name: account.name,
      color: account.color,
      blocked: account.resetting,
      pages: [...tabs.values()]
        .filter((tab) => tab.info.accountId === account.id)
        .map((tab) => ({ url: savedURL(tab.info.url), kind: tab.info.kind })),
    }));
  const file = path.join(app.getPath("userData"), "workspace.json");
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    const fd = openSync(`${file}.tmp`, "w", 0o600);
    try {
      writeFileSync(
        fd,
        JSON.stringify({ version: 1, accounts: saved }, null, 2),
      );
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(`${file}.tmp`, file);
  } catch (error) {
    console.error("Could not save workspace:", error);
    if (required)
      throw new Error(
        "Could not save the reset recovery state. Check disk space and profile permissions, then retry.",
      );
  }
}
function emit() {
  if (!window || window.isDestroyed() || quitting) return;
  const picker = locatorPicker.state();
  if (
    picker.picking &&
    (picker.tabId !== activeTabId || overlayOpen || settingsOpen || !toolsOpen)
  )
    locatorPicker.cancel();
  layout();
  window.webContents.send("qa:state-changed", state());
}
function layout() {
  if (!window || window.isDestroyed()) return;
  const [width, height] = window.getContentSize();
  for (const tab of tabs.values()) {
    tab.view.setBounds({
      x: 0,
      y: CHROME_HEIGHT,
      width: Math.max(0, width - (toolsOpen ? 460 : 0)),
      height: Math.max(0, height - CHROME_HEIGHT - FOOTER_HEIGHT),
    });
    tab.view.setVisible(
      tab.info.id === activeTabId &&
        tab.info.url !== "about:blank" &&
        !tab.info.error &&
        (!tab.pendingURL || tab.view.webContents.getURL() !== "about:blank") &&
        !overlayOpen &&
        !settingsOpen,
    );
  }
}
function accountById(id: string): Account {
  const account = accounts.get(id);
  if (!account) throw new Error("This account no longer exists.");
  return account;
}
function available(account: Account) {
  if (account.resetting)
    throw new Error(
      "This account is being reset. Wait for it to finish or retry the reset.",
    );
}
function active(): Tab {
  const tab = tabs.get(activeTabId);
  if (!tab) throw new Error("Select a tab first.");
  available(accountById(tab.info.accountId));
  return tab;
}
function secureContent(contents: WebContents, account: Account) {
  contents.on("context-menu", (_event, params) => {
    const items: Electron.MenuItemConstructorOptions[] = [
      {
        label: "Back",
        enabled: contents.navigationHistory.canGoBack(),
        click: () => contents.navigationHistory.goBack(),
      },
      {
        label: "Forward",
        enabled: contents.navigationHistory.canGoForward(),
        click: () => contents.navigationHistory.goForward(),
      },
      { label: "Reload", click: () => contents.reload() },
      { type: "separator" },
    ];
    if (isWebURL(params.linkURL))
      items.push(
        {
          label: "Open link in new tab in this group",
          enabled: tabs.size < 100 && !account.resetting,
          click: () => {
            if (tabs.size < 100 && !account.resetting)
              createTab(account, normalizeURL(params.linkURL));
          },
        },
        {
          label: "Copy link address",
          click: () => clipboard.writeText(params.linkURL),
        },
      );
    if (params.selectionText)
      items.push({ label: "Copy", click: () => contents.copy() });
    if (params.isEditable) items.push({ role: "cut" }, { role: "paste" });
    items.push(
      { type: "separator" },
      {
        label: "Inspect",
        click: () => {
          contents.openDevTools({ mode: devtoolsMode });
          contents.inspectElement(params.x, params.y);
        },
      },
    );
    Menu.buildFromTemplate(items).popup();
  });
  // Remote pages receive no preload bridge and cannot navigate to local/privileged schemes.
  contents.on("will-navigate", (event, url) => {
    if (!isWebURL(url) && url !== "about:blank") event.preventDefault();
  });
  contents.on("will-redirect", (event, url) => {
    if (!isWebURL(url) && url !== "about:blank") event.preventDefault();
  });
  contents.on("will-frame-navigate", (event) => {
    // Embedded documents may legitimately use srcdoc, data or blob; privileged
    // local schemes must never become a website frame.
    if (
      !isWebURL(event.url) &&
      !["about:", "data:", "blob:"].includes(new URL(event.url).protocol)
    )
      event.preventDefault();
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.setWindowOpenHandler((details) => {
    if (
      account.resetting ||
      quitting ||
      account.popups.size >= 8 ||
      (!isWebURL(details.url) && details.url !== "about:blank")
    )
      return { action: "deny" };
    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        autoHideMenuBar: true,
        width: 900,
        height: 740,
        webPreferences: {
          session: account.session,
          nodeIntegration: false,
          nodeIntegrationInWorker: false,
          nodeIntegrationInSubFrames: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          webviewTag: false,
        },
      },
    };
  });
  contents.on("did-create-window", (popup) => {
    account.popups.add(popup);
    secureContent(popup.webContents, account);
    popup.on("closed", () => account.popups.delete(popup));
  });
}
function createAccount(
  name: string,
  color: string,
  persistent: boolean,
  id: string = randomUUID(),
): Account {
  if (accounts.size >= 30)
    throw new Error("This workspace supports up to 30 accounts.");
  const partition = `${persistent ? "persist:" : ""}qa-${id}`;
  const ses = session.fromPartition(partition);
  registerRequestGroup(id, ses);
  // The prototype denies device permissions; it never silently grants remote sites native access.
  ses.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
  const account: Account = {
    id,
    name,
    color,
    persistent,
    partition,
    session: ses,
    resetting: false,
    popups: new Set(),
    downloads: new Set(),
  };
  ses.on("will-download", (event, item) => {
    if (account.resetting || quitting || account.downloads.size >= 5) {
      event.preventDefault();
      return;
    }
    item.setSaveDialogOptions({ title: `Save download — ${account.name}` });
    account.downloads.add(item);
    item.once("done", () => account.downloads.delete(item));
  });
  accounts.set(id, account);
  return account;
}
function createTab(
  account: Account,
  url = "about:blank",
  kind: "web" | "inbox" = "web",
): Tab {
  available(account);
  if (tabs.size >= 100)
    throw new Error("This workspace supports up to 100 tabs.");
  url = normalizeURL(url);
  const view = new WebContentsView({
    webPreferences: {
      session: account.session,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    },
  });
  const tab: Tab = {
    view,
    pendingURL: url,
    info: {
      id: randomUUID(),
      accountId: account.id,
      kind,
      title: "New tab",
      url,
      loading: false,
      canGoBack: false,
      canGoForward: false,
    },
  };
  tabs.set(tab.info.id, tab);
  window.contentView.addChildView(view);
  const wc = view.webContents;
  secureContent(wc, account);
  void targetId(wc).then((id) => {
    if (!wc.isDestroyed()) {
      tab.info.automationTargetId = id;
      emit();
    }
  });
  wc.on("found-in-page", (_event, result) => {
    window.webContents.send(
      "qa:shortcut",
      `find-result:${result.activeMatchOrdinal}/${result.matches}`,
    );
  });
  const update = () => {
    if (wc.isDestroyed() || !tabs.has(tab.info.id)) return;
    const current = wc.getURL();
    if (current && !tab.pendingURL) tab.info.url = current;
    tab.info.title =
      tab.info.url === "about:blank"
        ? "New tab"
        : (wc.getTitle() || new URL(tab.info.url).hostname).slice(0, 512);
    tab.info.loading = wc.isLoading();
    tab.info.canGoBack = wc.navigationHistory.canGoBack();
    tab.info.canGoForward = wc.navigationHistory.canGoForward();
    emit();
  };
  wc.on("did-start-loading", () => {
    tab.info.error = undefined;
    tab.info.loading = true;
    emit();
  });
  wc.on("did-start-navigation", (details) => {
    if (details.isMainFrame) locatorPicker.invalidate(tab.info.id);
  });
  wc.on("did-stop-loading", update);
  wc.on("page-title-updated", update);
  wc.on("did-navigate", () => {
    tab.pendingURL = undefined;
    update();
    save();
  });
  wc.on("did-navigate-in-page", () => {
    tab.pendingURL = undefined;
    update();
    save();
  });
  wc.on(
    "did-fail-load",
    (_event, code, description, failedURL, isMainFrame) => {
      if (!isMainFrame || code === -3 || !tabs.has(tab.info.id)) return;
      tab.info.url = failedURL || tab.info.url;
      tab.pendingURL = undefined;
      const help =
        code === -138
          ? "Network access was blocked. Check this computer’s firewall or proxy settings, then retry."
          : code === -106
            ? "This computer is offline. Check your connection, then retry."
            : "Check the address and connection, then retry.";
      tab.info.error = `Could not load this page (${description}). ${help}`;
      tab.info.loading = false;
      emit();
    },
  );
  wc.on("render-process-gone", (_event, details) => {
    tab.info.error = `This page stopped responding (${details.reason}). Reload to try again.`;
    tab.info.loading = false;
    emit();
  });
  activeTabId = tab.info.id;
  settingsOpen = false;
  void wc.loadURL(url).catch(() => {
    /* did-fail-load supplies the visible error. */
  });
  emit();
  save();
  if (initialized && url === "about:blank" && !overlayOpen) {
    window.webContents.focus();
    window.webContents.send("qa:shortcut", "address");
  }
  return tab;
}
function destroyTab(tab: Tab) {
  locatorPicker.invalidate(tab.info.id);
  tabs.delete(tab.info.id);
  window.contentView.removeChildView(tab.view);
  if (!tab.view.webContents.isDestroyed())
    tab.view.webContents.close({ waitForBeforeUnload: false });
}
async function clearAccount(account: Account) {
  stopRequests(account.id);
  for (const download of account.downloads) download.cancel();
  account.downloads.clear();
  for (const popup of [...account.popups])
    if (!popup.isDestroyed()) popup.destroy();
  account.popups.clear();
  // All writers are closed before clearing, including pages sharing this session and auth popups.
  await account.session.closeAllConnections();
  await account.session.clearStorageData();
  await account.session.clearCache();
  await account.session.clearAuthCache();
  await account.session.clearHostResolverCache();
  await account.session.cookies.flushStore();
}
async function resetAccount(account: Account, remove = false) {
  if (resetInFlight.has(account.id))
    throw new Error("Reset already in progress.");
  resetInFlight.add(account.id);
  account.resetting = true;
  try {
    // Persist the block before closing any writers or touching session storage.
    save(true);
  } catch (error) {
    account.resetting = false;
    resetInFlight.delete(account.id);
    emit();
    throw error;
  }
  const oldTabs = [...tabs.values()].filter(
    (tab) => tab.info.accountId === account.id,
  );
  const wasActive = oldTabs.some((tab) => tab.info.id === activeTabId);
  const pages = oldTabs.length
    ? oldTabs.map((tab) => ({ url: tab.info.url, kind: tab.info.kind }))
    : [{ url: "about:blank", kind: "web" as const }];
  for (const tab of oldTabs) destroyTab(tab);
  if (wasActive) activeTabId = [...tabs.keys()][0] || "";
  emit();
  save();
  try {
    await clearAccount(account);
    if (quitting) return;
    account.resetting = false;
    if (remove) {
      forgetRequestGroup(account.id);
      accounts.delete(account.id);
    } else {
      const previousActive = activeTabId;
      for (const page of pages)
        createTab(
          account,
          isWebURL(page.url) ? page.url : "about:blank",
          page.kind,
        );
      if (!wasActive && previousActive) activeTabId = previousActive;
    }
    if (!accounts.size) createTab(createAccount("Account 1", COLORS[0], false));
    emit();
    save();
  } catch (error) {
    // Keep the account blocked after failed cleanup, so it cannot silently reuse old data.
    emit();
    throw new Error(
      `Session cleanup failed. Retry reset before using this account. ${String(error)}`,
    );
  } finally {
    resetInFlight.delete(account.id);
  }
}
function string(value: unknown, max = 200): string {
  if (typeof value !== "string" || value.length > max)
    throw new Error("Invalid command value.");
  return value;
}
function trusted(event: IpcMainInvokeEvent) {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    event.senderFrame.url !== shellURL
  ) {
    throw new Error("Untrusted IPC sender.");
  }
}
async function command(raw: unknown) {
  if (!raw || typeof raw !== "object") throw new Error("Invalid command.");
  const cmd = raw as Record<string, unknown>;
  switch (cmd.type) {
    case "create-account": {
      if (accounts.size >= 30)
        throw new Error("This workspace supports up to 30 accounts.");
      const name = string(cmd.name, 60).trim();
      const color = string(cmd.color);
      if (
        !name ||
        !(COLORS as readonly string[]).includes(color) ||
        typeof cmd.persistent !== "boolean"
      )
        throw new Error("Choose an account name and colour.");
      const url = normalizeURL(string(cmd.url, 8192));
      const inboxURL =
        cmd.inboxURL === undefined ? "" : string(cmd.inboxURL, 8192);
      const inbox = inboxURL.trim() ? normalizeURL(inboxURL) : undefined;
      if (tabs.size + (inbox ? 2 : 1) > 100)
        throw new Error("This workspace supports up to 100 tabs.");
      const account = createAccount(name, color, cmd.persistent);
      const website = createTab(account, url);
      if (inbox) createTab(account, inbox, "inbox");
      activeTabId = website.info.id;
      emit();
      save();
      break;
    }
    case "rename-account": {
      const account = accountById(string(cmd.accountId));
      available(account);
      const name = string(cmd.name, 60).trim();
      if (!name) throw new Error("Enter an account name.");
      account.name = name;
      emit();
      save();
      break;
    }
    case "new-tab": {
      if (tabs.size >= 100)
        throw new Error("This workspace supports up to 100 tabs.");
      if (cmd.kind !== undefined && cmd.kind !== "web" && cmd.kind !== "inbox")
        throw new Error("Invalid tab kind.");
      createTab(
        accountById(string(cmd.accountId)),
        normalizeURL(cmd.url === undefined ? "" : string(cmd.url, 8192)),
        cmd.kind as "web" | "inbox" | undefined,
      );
      break;
    }
    case "activate-tab": {
      const tab = tabs.get(string(cmd.tabId));
      if (!tab) throw new Error("Tab no longer exists.");
      available(accountById(tab.info.accountId));
      activeTabId = tab.info.id;
      settingsOpen = false;
      emit();
      if (!overlayOpen && tab.info.url !== "about:blank" && !tab.info.error)
        tab.view.webContents.focus();
      break;
    }
    case "close-tab": {
      const tab = tabs.get(string(cmd.tabId));
      if (!tab) return;
      const account = accountById(tab.info.accountId);
      available(account);
      const wasActive = activeTabId === tab.info.id;
      rememberTab(tab);
      destroyTab(tab);
      const remaining = [...tabs.values()].filter(
        (item) => item.info.accountId === account.id,
      );
      if (!remaining.length) {
        const previous = activeTabId;
        createTab(account);
        if (!wasActive) activeTabId = previous;
      } else if (wasActive) activeTabId = remaining[0].info.id;
      emit();
      save();
      break;
    }
    case "reset-account":
      await resetAccount(accountById(string(cmd.accountId)));
      break;
    case "remove-account":
      await resetAccount(accountById(string(cmd.accountId)), true);
      break;
    case "navigate": {
      const url = addressURL(string(cmd.url, 8192));
      const tab = active();
      settingsOpen = false;
      tab.info.url = url;
      tab.info.error = undefined;
      tab.info.loading = true;
      tab.pendingURL = url;
      emit();
      void tab.view.webContents.loadURL(url).catch(() => {});
      save();
      break;
    }
    case "reopen-tab": {
      if (tabs.size >= 100)
        throw new Error("This workspace supports up to 100 tabs.");
      let closed;
      while ((closed = closedTabs.pop())) {
        const account = accounts.get(closed.accountId);
        if (account && !account.resetting) {
          createTab(account, closed.url, closed.kind);
          break;
        }
      }
      break;
    }
    case "reorder-tab": {
      const id = string(cmd.tabId);
      const before = string(cmd.beforeTabId);
      if (id === before) break;
      const tab = tabs.get(id);
      if (!tab || !tabs.has(before)) throw new Error("Tab no longer exists.");
      const ordered = [...tabs.entries()].filter(([key]) => key !== id);
      ordered.splice(
        ordered.findIndex(([key]) => key === before),
        0,
        [id, tab],
      );
      tabs.clear();
      ordered.forEach(([key, value]) => tabs.set(key, value));
      emit();
      save();
      break;
    }
    case "back": {
      const tab = active();
      settingsOpen = false;
      if (tab.view.webContents.navigationHistory.canGoBack())
        tab.view.webContents.navigationHistory.goBack();
      emit();
      break;
    }
    case "forward": {
      const tab = active();
      settingsOpen = false;
      if (tab.view.webContents.navigationHistory.canGoForward())
        tab.view.webContents.navigationHistory.goForward();
      emit();
      break;
    }
    case "reload": {
      const tab = active();
      settingsOpen = false;
      if (tab.info.error) {
        tab.info.error = undefined;
        void tab.view.webContents.loadURL(tab.info.url).catch(() => {});
      } else tab.view.webContents.reload();
      emit();
      break;
    }
    case "stop":
      active().view.webContents.stop();
      break;
    case "devtools": {
      const tab = active();
      settingsOpen = false;
      emit();
      tab.view.webContents.openDevTools({ mode: devtoolsMode });
      break;
    }
    case "devtools-mode": {
      if (!["right", "bottom", "detach"].includes(string(cmd.mode)))
        throw new Error("Invalid DevTools layout.");
      devtoolsMode = cmd.mode as typeof devtoolsMode;
      active().view.webContents.closeDevTools();
      active().view.webContents.openDevTools({ mode: devtoolsMode });
      break;
    }
    case "settings":
      if (typeof cmd.open !== "boolean")
        throw new Error("Invalid settings state.");
      settingsOpen = cmd.open;
      if (settingsOpen) window.webContents.focus();
      emit();
      break;
    case "locator-pick": {
      const tab = active();
      if (
        tab.info.url === "about:blank" ||
        tab.info.error ||
        tab.info.loading ||
        overlayOpen
      )
        throw new Error(
          "Open a website and wait for it to load before picking an element.",
        );
      toolsOpen = true;
      settingsOpen = false;
      emit();
      await locatorPicker.start(tab.view.webContents, tab.info);
      break;
    }
    case "locator-cancel":
      locatorPicker.cancel();
      break;
    case "locator-copy": {
      const result = locatorPicker.state().result;
      if (!result || result.tabId !== activeTabId)
        throw new Error("Pick an element in this tab first.");
      clipboard.writeText(result.code);
      break;
    }
    case "appearance": {
      const next = parseAppearance(cmd.appearance);
      const file = path.join(app.getPath("userData"), "preferences.json");
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(
        `${file}.tmp`,
        JSON.stringify({ version: 1, appearance: next }, null, 2),
        { mode: 0o600 },
      );
      renameSync(`${file}.tmp`, file);
      appearance = next;
      window.setBackgroundColor(appearance.background);
      emit();
      break;
    }
    case "tools":
      if (typeof cmd.open !== "boolean")
        throw new Error("Invalid tools state.");
      toolsOpen = cmd.open;
      if (toolsOpen) settingsOpen = false;
      emit();
      break;
    case "duplicate-tab": {
      const tab = tabs.get(string(cmd.tabId));
      if (!tab) throw new Error("Tab no longer exists.");
      if (tabs.size >= 100)
        throw new Error("This workspace supports up to 100 tabs.");
      createTab(accountById(tab.info.accountId), tab.info.url, tab.info.kind);
      break;
    }
    case "tab-menu": {
      const tab = tabs.get(string(cmd.tabId));
      if (!tab) throw new Error("Tab no longer exists.");
      const act = (value: unknown) => {
        void command(value).catch(console.error);
      };
      Menu.buildFromTemplate([
        {
          label: "New tab in this group",
          click: () => act({ type: "new-tab", accountId: tab.info.accountId }),
        },
        {
          label: "Duplicate tab",
          click: () => act({ type: "duplicate-tab", tabId: tab.info.id }),
        },
        { type: "separator" },
        {
          label: "Close tab",
          click: () => act({ type: "close-tab", tabId: tab.info.id }),
        },
        {
          label: "Close other tabs in this group",
          click: () => {
            for (const other of [...tabs.values()])
              if (
                other.info.accountId === tab.info.accountId &&
                other !== tab
              ) {
                rememberTab(other);
                destroyTab(other);
              }
            activeTabId = tab.info.id;
            emit();
            save();
          },
        },
      ]).popup({ window });
      break;
    }
    case "group-menu": {
      const account = accountById(string(cmd.accountId));
      const action = (name: string) =>
        window.webContents.send("qa:shortcut", `${name}:${account.id}`);
      Menu.buildFromTemplate([
        { label: "Rename group…", click: () => action("rename-group") },
        {
          label: "New tab",
          enabled: !account.resetting,
          click: () => createTab(account),
        },
        { type: "separator" },
        { label: "Reset group session…", click: () => action("reset-group") },
      ]).popup({ window });
      break;
    }
    case "browser-menu":
      Menu.getApplicationMenu()?.popup({ window });
      break;
    case "find": {
      const text = string(cmd.text, 500);
      const wc = active().view.webContents;
      if (text)
        wc.findInPage(text, { forward: cmd.forward !== false, findNext: true });
      else wc.stopFindInPage("clearSelection");
      break;
    }
    case "stop-find":
      active().view.webContents.stopFindInPage("clearSelection");
      break;
    case "zoom": {
      const wc = active().view.webContents;
      if (!["in", "out", "reset"].includes(string(cmd.direction)))
        throw new Error("Invalid zoom direction.");
      wc.setZoomFactor(
        cmd.direction === "reset"
          ? 1
          : Math.max(
              0.25,
              Math.min(
                5,
                wc.getZoomFactor() * (cmd.direction === "in" ? 1.1 : 1 / 1.1),
              ),
            ),
      );
      break;
    }
    case "screenshot": {
      const tab = active();
      const capture = await tab.view.webContents.capturePage();
      const result = await dialog.showSaveDialog(window, {
        defaultPath: `talos-${Date.now()}.png`,
        filters: [{ name: "PNG image", extensions: ["png"] }],
      });
      if (!result.canceled && result.filePath)
        writeFileSync(result.filePath, capture.toPNG());
      break;
    }
    case "overlay":
      if (typeof cmd.open !== "boolean")
        throw new Error("Invalid overlay state.");
      overlayOpen = cmd.open;
      emit();
      break;
    default:
      throw new Error("Unknown command.");
  }
}
function restore() {
  try {
    if (
      statSync(path.join(app.getPath("userData"), "workspace.json")).size >
      2 * 1024 * 1024
    )
      throw new Error("Workspace is too large.");
    const data = JSON.parse(
      readFileSync(
        path.join(app.getPath("userData"), "workspace.json"),
        "utf8",
      ),
    );
    if (data.version !== 1 || !Array.isArray(data.accounts)) return;
    for (const item of data.accounts.slice(0, 30) as SavedAccount[]) {
      if (
        !item ||
        typeof item.id !== "string" ||
        !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(
          item.id,
        ) ||
        accounts.has(item.id) ||
        typeof item.name !== "string" ||
        !item.name.trim() ||
        item.name.length > 60 ||
        !(COLORS as readonly string[]).includes(item.color) ||
        (!Array.isArray(item.urls) && !Array.isArray(item.pages))
      )
        continue;
      const account = createAccount(item.name, item.color, true, item.id);
      if (item.blocked) {
        account.resetting = true;
        continue;
      }
      const pages = Array.isArray(item.pages)
        ? item.pages
        : item.urls!.map((url) => ({ url, kind: "web" as const }));
      for (const page of (pages.length
        ? pages
        : [{ url: "about:blank", kind: "web" as const }]
      ).slice(0, 100 - tabs.size)) {
        const url = page?.url;
        createTab(
          account,
          typeof url === "string" && url.length <= 8192 && isWebURL(url)
            ? savedURL(url)
            : "about:blank",
          page?.kind === "inbox" ? "inbox" : "web",
        );
      }
      if (tabs.size >= 100) break;
    }
  } catch {
    /* Missing or malformed workspace starts fresh. */
  }
}
function createWindow() {
  const shellSession = session.fromPartition("talos-shell");
  shellSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );
  shellSession.setPermissionCheckHandler(() => false);
  shellSession.setDevicePermissionHandler(() => false);
  // Only renderer assets are served. Main/preload code and arbitrary local files
  // are never exposed, and website partitions have no handler for this scheme.
  const assets = new Map([
    ["/index.html", "text/html"],
    ["/renderer.js", "text/javascript"],
    ["/styles.css", "text/css"],
    ["/qa-styles.css", "text/css"],
    ["/compact.css", "text/css"],
    ["/icon.png", "image/png"],
  ]);
  shellSession.protocol.handle("talos", (request) => {
    const url = new URL(request.url);
    const type = assets.get(url.pathname);
    if (
      url.host !== "app" ||
      !type ||
      !["GET", "HEAD"].includes(request.method)
    )
      return new Response("Not found", { status: 404 });
    return new Response(
      request.method === "HEAD"
        ? null
        : new Uint8Array(
            readFileSync(path.join(__dirname, url.pathname.slice(1))),
          ),
      {
        headers: { "content-type": type, "x-content-type-options": "nosniff" },
      },
    );
  });
  try {
    if (
      statSync(path.join(app.getPath("userData"), "preferences.json")).size >
      16384
    )
      throw new Error("Preferences are too large.");
    const data = JSON.parse(
      readFileSync(
        path.join(app.getPath("userData"), "preferences.json"),
        "utf8",
      ),
    );
    if (data.version === 1) appearance = parseAppearance(data.appearance);
  } catch {
    /* Missing or malformed preferences use the default palette. */
  }
  window = new BrowserWindow({
    icon: path.join(__dirname, "icon.png"),
    width: 1440,
    height: 960,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: appearance.background,
    title: "Talos",
    autoHideMenuBar: true,
    webPreferences: {
      session: shellSession,
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
    },
  });
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-frame-navigate", (event) =>
    event.preventDefault(),
  );
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.on("resize", layout);
  window.on("close", () => {
    save();
    quitting = true;
    for (const account of accounts.values())
      for (const popup of [...account.popups])
        if (!popup.isDestroyed()) popup.destroy();
    for (const tab of [...tabs.values()]) destroyTab(tab);
  });
  window.webContents.once("did-finish-load", emit);
  void window.loadURL(shellURL);
  restore();
  if (!accounts.size) {
    ["Account 1", "Account 2", "Account 3"].forEach((name, index) =>
      createTab(createAccount(name, COLORS[index], false)),
    );
    activeTabId = [...tabs.keys()][0];
  }
  initialized = true;
  emit();
  const shortcut = (action: string) => {
    window.focus();
    window.webContents.focus();
    window.webContents.send("qa:shortcut", action);
  };
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
      {
        label: "File",
        submenu: [
          {
            label: "New account group",
            accelerator: "CmdOrCtrl+Shift+N",
            click: () => shortcut("new-account"),
          },
          {
            label: "New tab in this account",
            accelerator: "CmdOrCtrl+T",
            click: () => shortcut("new-tab"),
          },
          {
            label: "Close tab",
            accelerator: "CmdOrCtrl+W",
            click: () => shortcut("close-tab"),
          },
          {
            label: "Address bar",
            accelerator: "CmdOrCtrl+L",
            click: () => shortcut("address"),
          },
          { type: "separator" },
          {
            label: "Reopen closed tab",
            accelerator: "CmdOrCtrl+Shift+T",
            click: () => {
              void command({ type: "reopen-tab" }).catch(console.error);
            },
          },
          {
            label: "Settings",
            accelerator: "CmdOrCtrl+,",
            click: () => shortcut("settings"),
          },
          { role: "quit" },
        ],
      },
      { role: "editMenu" },
      {
        label: "Page",
        submenu: [
          {
            label: "Back",
            accelerator: "Alt+Left",
            click: () => {
              void command({ type: "back" }).catch(console.error);
            },
          },
          {
            label: "Forward",
            accelerator: "Alt+Right",
            click: () => {
              void command({ type: "forward" }).catch(console.error);
            },
          },
          {
            label: "Developer tools",
            accelerator: "CmdOrCtrl+Shift+I",
            click: () => {
              void command({ type: "devtools" }).catch(console.error);
            },
          },
          {
            label: "Find in page",
            accelerator: "CmdOrCtrl+F",
            click: () => shortcut("find"),
          },
          {
            label: "Zoom in",
            accelerator: "CmdOrCtrl+Plus",
            click: () => {
              void command({ type: "zoom", direction: "in" });
            },
          },
          {
            label: "Zoom out",
            accelerator: "CmdOrCtrl+-",
            click: () => {
              void command({ type: "zoom", direction: "out" });
            },
          },
          {
            label: "Actual size",
            accelerator: "CmdOrCtrl+0",
            click: () => {
              void command({ type: "zoom", direction: "reset" });
            },
          },
          {
            label: "Next tab",
            accelerator: "Ctrl+Tab",
            click: () => {
              const groupId = tabs.get(activeTabId)?.info.accountId;
              const ids = [...tabs.values()]
                .filter((tab) => tab.info.accountId === groupId)
                .map((tab) => tab.info.id);
              if (!ids.length) return;
              void command({
                type: "activate-tab",
                tabId: ids[(ids.indexOf(activeTabId) + 1) % ids.length],
              });
            },
          },
          {
            label: "Previous tab",
            accelerator: "Ctrl+Shift+Tab",
            click: () => {
              const groupId = tabs.get(activeTabId)?.info.accountId;
              const ids = [...tabs.values()]
                .filter((tab) => tab.info.accountId === groupId)
                .map((tab) => tab.info.id);
              if (!ids.length) return;
              void command({
                type: "activate-tab",
                tabId:
                  ids[(ids.indexOf(activeTabId) - 1 + ids.length) % ids.length],
              });
            },
          },
          {
            label: "Reload",
            accelerator: "CmdOrCtrl+R",
            click: () => {
              void command({ type: "reload" }).catch(console.error);
            },
          },
          {
            label: "Developer tools",
            accelerator: "F12",
            click: () => {
              void command({ type: "devtools" }).catch(console.error);
            },
          },
        ],
      },
      {
        label: "QA tools",
        submenu: [
          {
            label: "QA workspace",
            accelerator: "CmdOrCtrl+Shift+Q",
            click: () => shortcut("tools"),
          },
          {
            label: "Capture page screenshot…",
            click: () => {
              void command({ type: "screenshot" }).catch(console.error);
            },
          },
        ],
      },
    ]),
  );
}
ipcMain.handle("qa:state", (event) => {
  trusted(event);
  return state();
});
ipcMain.handle("qa:command", async (event, raw) => {
  trusted(event);
  await command(raw);
});
ipcMain.handle("qa:request", async (event, request) => {
  trusted(event);
  if (!request || typeof request !== "object")
    throw new Error("Invalid request.");
  available(accountById(string(request.accountId)));
  return sendRequest(request);
});
ipcMain.handle("qa:automation", (event) => {
  trusted(event);
  return {
    enabled: automationEnabled,
    endpoint: automationEndpoint(),
    adapterURL: pathToFileURL(
      app.isPackaged
        ? path.join(process.resourcesPath, "playwright-adapter", "talos.cjs")
        : path.join(
            app.getAppPath(),
            "integrations",
            "playwright",
            "talos.cjs",
          ),
    ).href,
    targets: [...tabs.values()].map((tab) => ({
      tabId: tab.info.id,
      targetId: tab.info.automationTargetId,
      groupId: tab.info.accountId,
      groupName: accountById(tab.info.accountId).name,
      kind: tab.info.kind,
      url: tab.info.url,
    })),
  };
});
app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
