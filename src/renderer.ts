import {
  COLORS,
  DEFAULT_APPEARANCE,
  type BrowserAPI,
  type WorkspaceState,
  type Command,
  type AccountInfo,
} from "./shared";
import { initTools } from "./tools";
import { initAppearance } from "./appearance";
declare global {
  interface Window {
    qa: BrowserAPI;
  }
}
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
let workspace: WorkspaceState = {
  accounts: [],
  tabs: [],
  activeTabId: "",
  appearance: { ...DEFAULT_APPEARANCE },
};
let pageKey = "";
let modalAccount: AccountInfo | undefined;
let modalType = "";
let lastFocus: HTMLElement | null = null;
let messageTimer: ReturnType<typeof setTimeout>;
const lastGroupTab = new Map<string, string>();
const currentTab = () =>
  workspace.tabs.find((tab) => tab.id === workspace.activeTabId);
const currentAccount = () =>
  workspace.accounts.find((account) => account.id === currentTab()?.accountId);
const tools = initTools(() => workspace, run, notify);
const appearance = initAppearance(run);
function notify(message: string) {
  $("message").textContent = message;
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => {
    $("message").textContent = "";
  }, 9000);
}
async function run(command: Command): Promise<boolean> {
  try {
    await window.qa.command(command);
    return true;
  } catch (error) {
    notify(
      String(error).replace(
        /^Error: (?:Error invoking remote method '[^']+': Error: )?/,
        "",
      ),
    );
    return false;
  }
}
function render(state: WorkspaceState) {
  workspace = state;
  appearance.render(state);
  tools.render();
  const tab = currentTab();
  const account = currentAccount();
  if (tab) lastGroupTab.set(tab.accountId, tab.id);
  $("accounts").innerHTML = state.accounts
    .map((item) => {
      const accountTabs = state.tabs.filter((tab) => tab.accountId === item.id);
      const selected = item.id === account?.id;
      return `<div class="account-card ${selected ? "selected" : ""}" style="--account-color:${item.color}">
      <button class="account-select" data-select-account="${item.id}" aria-pressed="${selected}" title="${escape(item.name)} · ${item.resetting ? "Resetting session" : item.persistent ? "Saved session" : "Temporary session"}" ${item.resetting ? "disabled" : ""}>
        <span class="group-dot"></span>
        <span class="account-text"><strong>${escape(item.name)}</strong></span>
        <span class="account-tab-count">${accountTabs.length}</span>
      </button>
      <button class="account-menu" data-account-menu="${item.id}" aria-label="Manage ${escape(item.name)}" title="Manage account">···</button>
    </div>`;
    })
    .join("");
  $("tabs").innerHTML = state.tabs
    .filter((item) => item.accountId === account?.id)
    .map((item) => {
      const owner = state.accounts.find(
        (account) => account.id === item.accountId,
      )!;
      return `<div draggable="true" data-tab-id="${item.id}" class="browser-tab ${item.id === tab?.id ? "active" : ""}" style="--account-color:${owner.color}"><button role="tab" aria-selected="${item.id === tab?.id}" data-activate="${item.id}" title="${escape(owner.name)} · ${escape(item.title)}"><span class="tab-dot ${item.loading ? "loading" : ""}"></span><span>${item.kind === "inbox" ? "Inbox · " : ""}${escape(item.title)}</span></button><button class="close-tab" data-close="${item.id}" aria-label="Close ${escape(item.title)}">×</button></div>`;
    })
    .join("");
  $("tabs")
    .querySelector('[aria-selected="true"]')
    ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  if (document.activeElement !== $("address"))
    ($("address") as HTMLInputElement).value =
      tab?.url === "about:blank" ? "" : tab?.url || "";
  $("address-account").innerHTML = account
    ? `<span style="color:${account.color}">●</span> ${escape(account.name)}`
    : "";
  ($("back") as HTMLButtonElement).disabled = !tab?.canGoBack;
  ($("forward") as HTMLButtonElement).disabled = !tab?.canGoForward;
  $("reload").textContent = tab?.loading ? "×" : "↻";
  $("reload").setAttribute(
    "aria-label",
    tab?.loading ? "Stop loading" : "Reload",
  );
  for (const id of ["reset", "devtools", "new-tab"])
    $<HTMLButtonElement>(id).disabled = !account || account.resetting;
  $("session-status").innerHTML = account
    ? `<span class="status-dot" style="background:${account.color}"></span><strong>${escape(account.name)}</strong><span class="footer-separator">/</span>${account.persistent ? "Saved on this device" : "Temporary session"}<span class="footer-separator">/</span>${state.tabs.filter((item) => item.accountId === account.id).length} tab(s) sharing this session`
    : "Choose an account";
  const nextKey = `${account?.id}:${tab?.url === "about:blank"}:${tab?.loading}:${tab?.error || ""}`;
  if (nextKey !== pageKey) {
    pageKey = nextKey;
    if (tab?.error) {
      $("page").innerHTML =
        `<section class="error-page"><span class="eyebrow">PAGE UNAVAILABLE</span><h1>Let’s try that again.</h1><p>${escape(tab.error)}</p><button class="primary" id="retry">Reload page <span>↻</span></button></section>`;
      $("retry").onclick = () => {
        void run({ type: "reload" });
      };
    } else if (!tab || tab.url === "about:blank") renderHome(account);
    else
      $("page").innerHTML = tab.loading
        ? '<div class="page-loading" role="status">Loading page…</div>'
        : "";
  }
}
function renderHome(account?: AccountInfo) {
  $("page").innerHTML = `<div class="home">
    <div class="home-top"><span class="eyebrow"><span class="status-dot"></span> YOUR TESTING SPACE, UNTANGLED</span><span class="home-edition">WORKSPACE / 001</span></div>
    <section class="hero"><div class="hero-copy"><h1>Every role.<br><span>One workspace.</span></h1><p>Test the same product as different people.<br>Your app and inbox, grouped by identity.</p></div>
      <div class="session-art" aria-hidden="true"><div class="art-orbit"></div><div class="art-card card-investor"><span class="mini-avatar">I</span><span>Investor<small>Session 01</small></span><i>●</i></div><div class="art-card card-adviser"><span class="mini-avatar">A</span><span>Adviser<small>Session 02</small></span><i>●</i></div><div class="art-card card-admin"><span class="mini-avatar">A</span><span>Admin<small>Session 03</small></span><i>●</i></div><span class="art-caption">THREE ROLES. ZERO CROSSED WIRES.</span></div>
    </section>
    <section class="start-panel"><div class="start-heading"><span class="step-number">01</span><div><h2>Where are we testing?</h2><p>Open your app as <strong style="color:${account?.color || COLORS[0]}">${escape(account?.name || "your account")}</strong>. The other accounts stay independent.</p></div><span class="clean-badge">◇ ISOLATED SESSION</span></div>
      <form id="start-form"><input id="start-url" aria-label="App address" placeholder="https://your-app.com or localhost:3000" autocomplete="off" spellcheck="false" required><button class="primary" type="submit">Open website <span>↗</span></button></form>
      <div class="start-note">Already have a test environment? Paste its URL. Sign in normally inside each account.</div>
    </section>
    <div class="feature-grid"><article><span class="feature-symbol">◫</span><h3>Your app. Your inbox.</h3><p>Keep a role’s website and email together. Get login codes without switching browsers.</p></article><article><span class="feature-symbol">⤮</span><h3>Share only when you choose</h3><p>Add a tab under an account to test the same user across multiple pages.</p></article><article><span class="feature-symbol">⟲</span><h3>Start fresh, stay in flow</h3><p>Reset one account’s data and pages. Keep the rest of your testing session going.</p></article></div>
    <div class="home-bottom"><span>MADE FOR THE PEOPLE WHO FIND THE EDGE CASES.</span><span>Use <kbd>Ctrl</kbd> <kbd>L</kbd> to jump to an address <span>↗</span></span></div>
  </div>`;
  $("start-form").onsubmit = (event) => {
    event.preventDefault();
    void run({ type: "navigate", url: $<HTMLInputElement>("start-url").value });
  };
}
const dialog = $<HTMLDialogElement>("dialog");
async function openModal(type: string, account = currentAccount()) {
  if (dialog.open) return;
  lastFocus = document.activeElement as HTMLElement;
  if (!(await run({ type: "overlay", open: true }))) return;
  modalType = type;
  modalAccount = account;
  const close =
    '<button type="button" class="modal-close" data-cancel aria-label="Close dialog">×</button>';
  if (type === "create") {
    $("dialog-form").innerHTML =
      `${close}<span class="eyebrow">A NEW PERSPECTIVE</span><h2>Create an account group.</h2><p>Pair a website with its email inbox. This group gets its own isolated session.</p><label>Group name<input id="account-name" maxlength="60" placeholder="e.g. Investor 2" required autofocus></label><label>Starting website <span class="optional">optional</span><input id="account-url" placeholder="https://your-app.com" value="${escape(currentTab()?.url === "about:blank" ? "" : currentTab()?.url || "")}"></label><label>Email inbox address <span class="optional">optional</span><input id="inbox-url" placeholder="https://mail.your-company.com"><small class="field-note">Your webmail website. Sign in inside this group to receive login codes.</small></label><fieldset class="colours"><legend>Account colour</legend>${COLORS.map((color, index) => `<label style="--swatch:${color}"><input type="radio" name="colour" value="${color}" ${index === workspace.accounts.length % COLORS.length ? "checked" : ""}><span></span></label>`).join("")}</fieldset><label class="save-check"><input id="persistent" type="checkbox"><span><strong>Keep this session between launches</strong><small>Saves browser data on this device. Unchecked accounts are temporary.</small></span></label><div class="modal-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit" class="primary">Create group <span>＋</span></button></div>`;
  } else if (type === "inbox" && account) {
    $("dialog-form").innerHTML =
      close +
      '<span class="eyebrow">EMAIL, IN THE SAME PLACE</span><h2>Attach an inbox.</h2><p>Open webmail for ' +
      escape(account.name) +
      ' in this group. Sign into its email account normally to read login codes and verification links.</p><label>Webmail address<input id="inbox-url" placeholder="https://mail.your-company.com" required autofocus></label><div class="modal-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit" class="primary">Attach inbox <span>✉</span></button></div>';
  } else if (type === "manage" && account) {
    $("dialog-form").innerHTML =
      `${close}<span class="eyebrow">ACCOUNT SETTINGS</span><h2>${escape(account.name)}</h2><p>${account.persistent ? "This session is saved on this device." : "This session is temporary and won’t return after quitting."}</p><label>Group name<input id="account-name" value="${escape(account.name)}" maxlength="60" required autofocus></label><div class="settings-actions"><button type="button" class="secondary" id="manage-reset">⟲ Reset session data</button><button type="button" class="danger-text" id="manage-remove">Remove account</button></div><div class="modal-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit" class="primary">Save name</button></div>`;
    $("manage-reset").onclick = async () => {
      await closeModal();
      await openModal("reset", account);
    };
    $("manage-remove").onclick = async () => {
      await closeModal();
      await openModal("remove", account);
    };
  } else if (account) {
    const remove = type === "remove";
    $("dialog-form").innerHTML =
      `${close}<span class="eyebrow">${remove ? "REMOVE ACCOUNT" : "A CLEAN START"}</span><h2>${remove ? "Remove" : "Reset"} ${escape(account.name)}?</h2><p>This closes all of this account’s pages and popups and clears its cookies, storage, cache, and HTTP authentication data.</p><div class="reset-note">${remove ? "The account will be removed from your workspace." : "Its tabs reopen at their current addresses with a fresh session."} Your other accounts keep their data. Downloaded files remain on disk.</div><div class="modal-actions"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit" class="primary ${remove ? "danger" : ""}">${remove ? "Remove account" : "Reset session"}</button></div>`;
  }
  dialog.showModal();
  (
    $("dialog-form").querySelector("[autofocus]") as HTMLElement | null
  )?.focus();
}
async function closeModal() {
  dialog.close();
  await run({ type: "overlay", open: false });
  lastFocus?.focus();
}
dialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  void closeModal();
});
dialog.addEventListener("click", (event) => {
  if ((event.target as HTMLElement).closest("[data-cancel]")) void closeModal();
});
$("dialog-form").onsubmit = async (event) => {
  event.preventDefault();
  const button = $("dialog-form").querySelector(
    'button[type="submit"]',
  ) as HTMLButtonElement;
  button.disabled = true;
  let command: Command;
  if (modalType === "create")
    command = {
      type: "create-account",
      name: $<HTMLInputElement>("account-name").value,
      color: (
        $("dialog-form").querySelector(
          'input[name="colour"]:checked',
        ) as HTMLInputElement
      ).value,
      persistent: $<HTMLInputElement>("persistent").checked,
      url: $<HTMLInputElement>("account-url").value,
      inboxURL: $<HTMLInputElement>("inbox-url").value,
    };
  else if (modalType === "inbox")
    command = {
      type: "new-tab",
      accountId: modalAccount!.id,
      kind: "inbox",
      url: $<HTMLInputElement>("inbox-url").value,
    };
  else if (modalType === "manage")
    command = {
      type: "rename-account",
      accountId: modalAccount!.id,
      name: $<HTMLInputElement>("account-name").value,
    };
  else
    command = {
      type: modalType === "remove" ? "remove-account" : "reset-account",
      accountId: modalAccount!.id,
    };
  if (await run(command)) {
    const message =
      modalType === "reset"
        ? `${modalAccount!.name} has a fresh session.`
        : modalType === "remove"
          ? "Account removed."
          : "";
    await closeModal();
    if (message) notify(message);
  } else button.disabled = false;
};
$("accounts").onclick = (event) => {
  const element = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "button",
  );
  if (!element) return;
  const data = element.dataset;
  if (data.selectAccount) {
    const tab =
      workspace.tabs.find(
        (tab) => tab.id === lastGroupTab.get(data.selectAccount!),
      ) || workspace.tabs.find((tab) => tab.accountId === data.selectAccount);
    if (tab) void run({ type: "activate-tab", tabId: tab.id });
  }
  if (data.accountMenu)
    void openModal(
      "manage",
      workspace.accounts.find((account) => account.id === data.accountMenu),
    );
  if (data.activate) void run({ type: "activate-tab", tabId: data.activate });
  if (data.inbox)
    void openModal(
      "inbox",
      workspace.accounts.find((account) => account.id === data.inbox),
    );
  if (data.shared)
    void run({
      type: "new-tab",
      accountId: data.shared,
      url: currentTab()?.url,
    });
};
$("tabs").onclick = (event) => {
  const element = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "button",
  );
  if (!element) return;
  if (element.dataset.activate)
    void run({ type: "activate-tab", tabId: element.dataset.activate });
  if (element.dataset.close)
    void run({ type: "close-tab", tabId: element.dataset.close });
};
$("new-account").onclick = () => {
  void openModal("create");
};
$("qa-tools").onclick = () => {
  if (workspace.settingsOpen) void run({ type: "tools", open: true });
  else void tools.toggle();
};
$("browser-menu").onclick = () => {
  void run({ type: "browser-menu" });
};
$("settings").onclick = () => {
  void run({ type: "settings", open: !workspace.settingsOpen });
};
$("tabs").oncontextmenu = (event) => {
  event.preventDefault();
  const button = (event.target as HTMLElement).closest<HTMLElement>(
    "[data-activate]",
  );
  if (button?.dataset.activate)
    void run({ type: "tab-menu", tabId: button.dataset.activate });
};
$("tabs").ondragstart = (event) => {
  const tab = (event.target as HTMLElement).closest<HTMLElement>(
    "[data-tab-id]",
  );
  if (tab) event.dataTransfer?.setData("text/talos-tab", tab.dataset.tabId!);
};
$("tabs").ondragover = (event) => {
  if (event.dataTransfer?.types.includes("text/talos-tab"))
    event.preventDefault();
};
$("tabs").ondrop = (event) => {
  event.preventDefault();
  const before = (event.target as HTMLElement).closest<HTMLElement>(
    "[data-tab-id]",
  );
  const id = event.dataTransfer?.getData("text/talos-tab");
  if (before && id)
    void run({
      type: "reorder-tab",
      tabId: id,
      beforeTabId: before.dataset.tabId!,
    });
};
$("tabs").onauxclick = (event) => {
  if (event.button !== 1) return;
  event.preventDefault();
  const tab = (event.target as HTMLElement).closest<HTMLElement>(
    "[data-tab-id]",
  );
  if (tab) void run({ type: "close-tab", tabId: tab.dataset.tabId! });
};
$("accounts").oncontextmenu = (event) => {
  event.preventDefault();
  const card = (event.target as HTMLElement).closest(".account-card");
  const button = card?.querySelector<HTMLElement>("[data-select-account]");
  if (button?.dataset.selectAccount)
    void run({ type: "group-menu", accountId: button.dataset.selectAccount });
};
$("accounts").ondblclick = (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>(
    "[data-select-account]",
  );
  if (button?.dataset.selectAccount)
    void openModal(
      "manage",
      workspace.accounts.find(
        (account) => account.id === button.dataset.selectAccount,
      ),
    );
};
function find(forward = true) {
  void run({
    type: "find",
    text: $<HTMLInputElement>("find-text").value,
    forward,
  });
}
$("find-text").oninput = () => find();
$("find-bar").onsubmit = (event) => {
  event.preventDefault();
  find();
};
$("find-next").onclick = () => find();
$("find-prev").onclick = () => find(false);
$("find-close").onclick = () => {
  $("find-bar").hidden = true;
  void run({ type: "stop-find" });
};
$("find-text").onkeydown = (event) => {
  if (event.key === "Escape") $("find-close").click();
};
$("new-tab").onclick = () => {
  const account = currentAccount();
  if (account) void run({ type: "new-tab", accountId: account.id });
};
$("reset").onclick = () => {
  void openModal("reset");
};
$("devtools").onclick = () => {
  void run({ type: "devtools" });
};
$("back").onclick = () => {
  void run({ type: "back" });
};
$("forward").onclick = () => {
  void run({ type: "forward" });
};
$("reload").onclick = () => {
  void run({ type: currentTab()?.loading ? "stop" : "reload" });
};
$("address-form").onsubmit = (event) => {
  event.preventDefault();
  const url = $<HTMLInputElement>("address").value;
  $("address").blur();
  void run({ type: "navigate", url });
};
window.qa.onShortcut((action) => {
  if (action.startsWith("find-result:")) {
    $("find-count").textContent = action.slice(12);
    return;
  }
  if (dialog.open) return;
  if (action === "settings") {
    $("settings").click();
    return;
  }
  if (action === "find") {
    $("find-bar").hidden = false;
    $("find-text").focus();
    return;
  }
  if (action === "tools") {
    $("qa-tools").click();
    return;
  }
  for (const [prefix, modal] of [
    ["rename-group", "manage"],
    ["attach-inbox", "inbox"],
    ["reset-group", "reset"],
  ]) {
    if (action.startsWith(`${prefix}:`)) {
      void openModal(
        modal,
        workspace.accounts.find(
          (account) => account.id === action.slice(prefix.length + 1),
        ),
      );
      return;
    }
  }
  if (action === "address") {
    $<HTMLInputElement>("address").focus();
    $<HTMLInputElement>("address").select();
  }
  if (action === "new-account") void openModal("create");
  if (action === "new-tab") $("new-tab").click();
  if (action === "close-tab" && currentTab())
    void run({ type: "close-tab", tabId: currentTab()!.id });
});
window.qa.onState(render);
void window.qa
  .state()
  .then(render)
  .catch((error) => notify(String(error)));
