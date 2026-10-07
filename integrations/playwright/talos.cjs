/** Connect standard Playwright to a running Talos started with --qa-automation. */
async function connectTalos(chromium, endpoint) {
  const url = new URL(endpoint);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  )
    throw new Error("Use Talos’s localhost CDP endpoint.");
  const browser = await chromium.connectOverCDP(endpoint);
  const pages = () => browser.contexts().flatMap((context) => context.pages());
  const shell = pages().find((page) => page.url() === "talos://app/index.html");
  if (!shell) {
    await browser.close();
    throw new Error("No Talos shell found at this endpoint.");
  }
  async function snapshot() {
    return shell.evaluate(() => window.qa.automation());
  }
  async function targets() {
    const info = await snapshot();
    const result = [];
    for (const page of pages()) {
      if (page === shell) continue;
      const client = await page.context().newCDPSession(page);
      try {
        const { targetInfo } = await client.send("Target.getTargetInfo");
        const tab = info.targets.find(
          (tab) => tab.targetId === targetInfo.targetId,
        );
        if (tab) result.push({ ...tab, page });
      } finally {
        await client.detach();
      }
    }
    return result;
  }
  return {
    browser,
    async groups() {
      const items = (await snapshot()).targets;
      return [
        ...new Map(
          items.map((tab) => [
            tab.groupId,
            { id: tab.groupId, name: tab.groupName },
          ]),
        ).values(),
      ];
    },
    async group(nameOrId) {
      const all = await targets();
      const matches = all.filter(
        (tab) => tab.groupId === nameOrId || tab.groupName === nameOrId,
      );
      if (!matches.length) throw new Error(`No open Talos group: ${nameOrId}`);
      if (new Set(matches.map((tab) => tab.groupId)).size > 1)
        throw new Error("Group name is ambiguous. Use a group ID.");
      return {
        id: matches[0].groupId,
        name: matches[0].groupName,
        tabs: matches,
        websites: matches
          .filter((tab) => tab.kind === "web")
          .map((tab) => tab.page),
        inboxes: matches
          .filter((tab) => tab.kind === "inbox")
          .map((tab) => tab.page),
      };
    },
    async page(tabId) {
      const tab = (await targets()).find((tab) => tab.tabId === tabId);
      if (!tab) throw new Error("Talos tab no longer exists.");
      return tab.page;
    },
    async disconnect() {
      await browser.close();
    },
  };
}
module.exports = { connectTalos };
