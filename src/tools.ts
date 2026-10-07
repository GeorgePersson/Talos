import type { WorkspaceState, Command, APIResponse } from "./shared";
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
type Section = "locator" | "api" | "automation";
interface Draft {
  method: string;
  url: string;
  headers: string;
  body: string;
  useSession: boolean;
  response?: APIResponse;
  error?: string;
  busy?: boolean;
}
export function initTools(
  getState: () => WorkspaceState,
  run: (cmd: Command) => Promise<boolean>,
  notify: (message: string) => void,
) {
  let section: Section = "locator";
  let renderedGroup = "";
  let automationKey = "";
  let locatorKey = "";
  const drafts = new Map<string, Draft>();
  const group = () =>
    getState().accounts.find(
      (account) =>
        account.id ===
        getState().tabs.find((tab) => tab.id === getState().activeTabId)
          ?.accountId,
    );
  function draft() {
    const id = group()?.id || "";
    if (!drafts.has(id))
      drafts.set(id, {
        method: "GET",
        url: "",
        headers: "{}",
        body: "",
        useSession: true,
      });
    return drafts.get(id)!;
  }
  function header() {
    $("qa-drawer").innerHTML =
      `<div class="qa-heading"><div><strong>QA workspace</strong><small id="qa-group"></small></div><button id="qa-close" aria-label="Close QA workspace">×</button></div><nav class="qa-tabs" aria-label="QA tools sections">${(["locator", "api", "automation"] as Section[]).map((name) => `<button data-section="${name}" aria-pressed="${name === section}">${{ locator: "Locator picker", api: "API tester", automation: "Playwright" }[name]}</button>`).join("")}</nav><div id="qa-content"></div>`;
    $("qa-close").onclick = () => {
      void run({ type: "tools", open: false });
    };
    $("qa-drawer")
      .querySelectorAll<HTMLButtonElement>("[data-section]")
      .forEach(
        (button) =>
          (button.onclick = () => {
            if (section === "locator" && button.dataset.section !== "locator")
              void run({ type: "locator-cancel" });
            section = button.dataset.section as Section;
            renderedGroup = "";
            render();
          }),
      );
  }
  function render() {
    const state = getState();
    for (const id of drafts.keys()) {
      const account = state.accounts.find((account) => account.id === id);
      if (!account || account.resetting) drafts.delete(id);
    }
    const account = group();
    $("qa-drawer").hidden = !state.toolsOpen;
    document.body.classList.toggle("tools-open", !!state.toolsOpen);
    if (!state.toolsOpen) return;
    if (!$("qa-content")) header();
    $("qa-group").textContent = account
      ? `Group: ${account.name}`
      : "Select a group to inspect";
    if (!account) {
      $("qa-content").innerHTML =
        '<p class="qa-empty">Select a tab to use the QA tools.</p>';
      return;
    }
    if (renderedGroup !== account.id) {
      automationKey = "";
      renderedGroup = account.id;
      locatorKey = "";
      header();
      $("qa-group").textContent = `Group: ${account.name}`;
      if (section === "locator") renderLocator();
      else if (section === "api") renderAPI();
      else if (section === "automation") {
        $("qa-content").innerHTML =
          '<p class="qa-empty">Checking Playwright connection…</p>';
        void renderAutomation().catch((error) => notify(String(error)));
      }
    }
    if (section === "locator") renderLocator();
  }
  function renderLocator() {
    const state = getState();
    const tab = state.tabs.find((tab) => tab.id === state.activeTabId);
    const picker = state.locator;
    const result =
      picker?.result && picker.result.tabId === tab?.id
        ? picker.result
        : undefined;
    const picking = !!picker?.picking && picker.tabId === tab?.id;
    const key = JSON.stringify([
      picker,
      tab?.id,
      tab?.loading,
      tab?.url,
      tab?.error,
    ]);
    if (key === locatorKey) return;
    locatorKey = key;
    const ready =
      tab && tab.url !== "about:blank" && !tab.loading && !tab.error;
    $("qa-content").innerHTML =
      `<div class="locator-panel"><span class="eyebrow">PLAYWRIGHT LOCATORS</span><h2>Point. Pick. Copy.</h2><p>Select an element on the active website to get a locator for your test.</p><button class="primary" id="locator-pick" ${!ready && !picking ? "disabled" : ""}>${picking ? "Cancel picking" : "Pick an element"}</button><p class="locator-instructions" role="status">${picking ? "Hover over the page, then click an element. Escape cancels." : ready ? "The picker highlights elements and captures your selection without activating it." : "Open a website and wait for it to load to start picking."}</p>${picker?.error && picker.tabId === tab?.id ? `<p class="qa-error" role="alert">${escape(picker.error)}</p>` : ""}${result ? `<div class="locator-result"><span class="locator-strategy">${escape(result.strategy)}</span><h3>${escape(result.tag)}${result.name ? ` · ${escape(result.name)}` : ""}</h3><pre id="locator-code">${escape(result.code)}</pre><button class="secondary" id="locator-copy">Copy locator</button><details class="request-details"><summary>CSS fallback</summary><pre>${escape(result.css)}</pre></details><p class="qa-footnote">${escape(result.note)}</p></div>` : '<p class="qa-empty">Your locator will appear here.</p>'}<p class="qa-footnote">Uses unique test IDs or a role and accessible name where possible, then falls back to CSS. The default test ID attribute is data-testid. Close this tab’s DevTools before picking.</p></div>`;
    $("locator-pick").onclick = () => {
      void run({ type: picking ? "locator-cancel" : "locator-pick" });
    };
    if (result)
      $("locator-copy").onclick = async () => {
        if (await run({ type: "locator-copy" })) notify("Locator copied.");
      };
  }
  function renderAPI() {
    const value = draft();
    $("qa-content").innerHTML =
      `<form id="api-form" class="api-form"><div class="api-url-row"><select id="api-method" aria-label="HTTP method">${["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map((method) => `<option ${method === value.method ? "selected" : ""}>${method}</option>`).join("")}</select><input id="api-url" aria-label="API request URL" placeholder="https://api.example.test/users" value="${escape(value.url)}" required></div><label>Headers <span>JSON object</span><textarea id="api-headers" aria-label="Request headers" spellcheck="false">${escape(value.headers)}</textarea></label><label>Request body<textarea id="api-body" aria-label="Request body" rows="5" placeholder='{"example": "value"}' spellcheck="false">${escape(value.body)}</textarea></label><label class="api-session"><input type="checkbox" id="api-session" ${value.useSession ? "checked" : ""}> Use this group’s cookies and session</label><button class="primary" id="api-send" type="submit" ${value.busy ? "disabled" : ""}>${value.busy ? "Sending…" : "Send request"} <span>↗</span></button><p class="qa-footnote">Requests use Chromium’s network stack. Redirects are returned without following them. Response preview is capped at 2 MiB; timeout is 30 seconds.</p></form><div id="api-result" aria-live="polite"></div>`;
    const saveDraft = () => {
      value.url = $<HTMLInputElement>("api-url").value;
      value.method = $<HTMLSelectElement>("api-method").value;
      value.headers = $<HTMLTextAreaElement>("api-headers").value;
      value.body = $<HTMLTextAreaElement>("api-body").value;
      value.useSession = $<HTMLInputElement>("api-session").checked;
    };
    $("api-form").oninput = saveDraft;
    $("api-form").onsubmit = async (event) => {
      event.preventDefault();
      saveDraft();
      const owner = group();
      if (!owner) return;
      value.busy = true;
      value.error = undefined;
      $("api-send").textContent = "Sending…";
      $<HTMLButtonElement>("api-send").disabled = true;
      try {
        value.response = await window.qa.request({
          accountId: owner.id,
          method: value.method,
          url: value.url,
          headers: JSON.parse(value.headers),
          body: value.body,
          useSession: value.useSession,
        });
      } catch (error) {
        value.error = String(error);
      } finally {
        value.busy = false;
        if (
          group()?.id === owner.id &&
          section === "api" &&
          getState().toolsOpen &&
          $("api-send")
        ) {
          $("api-send").textContent = "Send request ↗";
          $<HTMLButtonElement>("api-send").disabled = false;
          renderResponse(value);
        }
      }
    };
    renderResponse(value);
  }
  function renderResponse(value: Draft) {
    if (value.error) {
      $("api-result").innerHTML =
        `<p class="qa-error" role="alert">${escape(value.error)}</p>`;
      return;
    }
    const response = value.response;
    if (!response) {
      $("api-result").innerHTML =
        '<p class="qa-empty">Send a request to inspect the response.</p>';
      return;
    }
    let body = response.body;
    try {
      body = JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      /* Plain-text/binary UTF-8 preview. */
    }
    $("api-result").innerHTML =
      `<div class="response-status"><strong>${response.status} ${escape(response.statusText)}</strong><span>${response.duration} ms · ${response.bytes.toLocaleString()} bytes</span></div>${response.truncated ? '<p class="qa-error">Response preview truncated at 2 MiB.</p>' : ""}<details class="request-details"><summary>Response headers</summary><pre>${escape(JSON.stringify(response.headers, null, 2))}</pre></details><h3>Response body</h3><pre class="response-body">${escape(body || "(empty body)")}</pre>`;
  }
  async function renderAutomation() {
    const info = await window.qa.automation();
    if (section !== "automation" || !getState().toolsOpen) return;
    const owner = group();
    const key = JSON.stringify([info, owner?.id, owner?.name]);
    if (key === automationKey) return;
    automationKey = key;
    const code = `// Save as live-test.mjs; requires Playwright.\nimport { chromium } from 'playwright';\nimport adapter from ${JSON.stringify(info.adapterURL)};\n\nconst talos = await adapter.connectTalos(chromium, ${JSON.stringify(info.endpoint || "http://127.0.0.1:PORT")});\ntry {\n  const group = await talos.group(${JSON.stringify(owner?.id || "Account 1")});\n  const page = group.websites[0];\n  console.log(await page.title());\n  // Use normal Playwright locators and assertions.\n} finally { await talos.disconnect(); }`;
    $("qa-content").innerHTML =
      `<div class="automation-panel"><span class="connection-status ${info.endpoint ? "connected" : ""}">${info.endpoint ? "● Ready to connect" : "○ Automation is off"}</span><h2>Bring your Playwright tests.</h2><p>Connect to the pages and isolated groups already open in Talos. Use normal locators, screenshots, assertions, and traces.</p>${info.endpoint ? `<label>Local CDP endpoint<input readonly aria-label="Automation endpoint" value="${escape(info.endpoint)}"></label>` : '<p>Close Talos and start in automation mode:</p><pre>npm run start:automation</pre><p>Packaged app:</p><pre>Windows: Talos.exe --qa-automation&#10;Linux: talos --qa-automation&#10;macOS: open -a Talos --args --qa-automation</pre><p class="qa-footnote">Automation mode starts a debugging endpoint on localhost. Connected tools can control every group and the local shell. Enable it only while testing with tools you trust.</p>'}<h3>Connect with the Talos adapter</h3><pre class="automation-code">${escape(code)}</pre><p class="qa-footnote">Adapter: integrations/playwright/talos.cjs. Duplicate group names require a group ID. This is live browser automation; it can change the website and its data.</p><div class="automation-targets">${info.targets
        .filter((target) => target.groupId === owner?.id)
        .map(
          (target) =>
            `<div><strong>${target.kind === "inbox" ? "✉ Inbox" : "Website tab"}</strong><small>${escape(target.url)}</small></div>`,
        )
        .join("")}</div></div>`;
  }
  setInterval(() => {
    if (
      getState().toolsOpen &&
      !getState().settingsOpen &&
      section === "automation"
    )
      void renderAutomation().catch((error) => notify(String(error)));
  }, 1500);
  return {
    render,
    toggle: () => run({ type: "tools", open: !getState().toolsOpen }),
  };
}
