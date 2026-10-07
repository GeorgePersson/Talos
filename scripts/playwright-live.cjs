const { chromium } = require("playwright");
const { connectTalos } = require("../integrations/playwright/talos.cjs");
async function main() {
  const endpoint = process.argv[2];
  if (!endpoint)
    throw new Error(
      "Usage: npm run playwright:connect -- http://127.0.0.1:PORT",
    );
  const talos = await connectTalos(chromium, endpoint);
  try {
    for (const item of await talos.groups()) {
      const group = await talos.group(item.id);
      console.log(
        `${group.name} (${group.id}): ${group.websites.length} website tab(s), ${group.inboxes.length} inbox(es)`,
      );
      for (const tab of group.tabs)
        console.log(
          `  ${tab.kind}: ${await tab.page.title()} — ${tab.page.url()}`,
        );
    }
  } finally {
    await talos.disconnect();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
