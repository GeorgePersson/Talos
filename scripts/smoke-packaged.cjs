const { _electron, chromium } = require("@playwright/test");
const { fileURLToPath } = require("node:url");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { startFixture } = require("./fixture-server.cjs");
async function main() {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), "talos-package-"));
  let app;
  let fixture;
  try {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({
      chromiumSandbox: true,
      executablePath: path.resolve(
        process.env.TALOS_EXECUTABLE ||
          (process.platform === "win32"
            ? "release/win-unpacked/Talos.exe"
            : process.platform === "darwin"
              ? `release/mac${process.arch === "arm64" ? "-arm64" : ""}/Talos.app/Contents/MacOS/Talos`
              : `release/linux${process.arch === "arm64" ? "-arm64" : ""}-unpacked/talos`),
      ),
      args: [
        `--qa-user-data=${userData}`,
        ...(process.argv.includes("--automation") ? ["--qa-automation"] : []),
      ],
      env,
    });
    await app.firstWindow();
    let shell;
    const deadline = Date.now() + 15000;
    while (!shell && Date.now() < deadline) {
      shell = app.windows().find((page) => page.url().endsWith("/index.html"));
      if (!shell) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!shell) throw new Error("Packaged shell did not open.");
    await shell.waitForFunction(() => !!window.qa);
    await shell
      .getByRole("heading", { name: "Every role. One workspace." })
      .waitFor();
    const state = await shell.evaluate(() => window.qa.state());
    if (state.accounts.length !== 3 || state.tabs.length !== 3)
      throw new Error("Default workspace did not initialise.");
    await shell.getByRole("navigation", { name: "Account groups" }).waitFor();
    if (await shell.getByRole("button", { name: /Attach email inbox/ }).count())
      throw new Error("Removed inbox button is still present.");
    await shell.getByRole("button", { name: "Settings", exact: true }).click();
    await shell
      .getByRole("heading", { name: "Settings", exact: true })
      .waitFor();
    if ((await shell.locator("#hex-background").inputValue()) !== "#000000")
      throw new Error("Default appearance did not load.");
    await shell.getByRole("button", { name: "Back to browsing" }).click();
    await shell.getByRole("button", { name: "QA tools", exact: true }).click();
    await shell
      .getByRole("button", { name: "Pick an element", exact: true })
      .waitFor();
    fixture = await startFixture();
    const website = `${fixture.url}/?packaged`;
    await shell.evaluate(
      (url) => window.qa.command({ type: "navigate", url }),
      website,
    );
    let guest;
    const pageDeadline = Date.now() + 15000;
    while (!guest && Date.now() < pageDeadline) {
      guest = app.windows().find((page) => page.url() === website);
      if (!guest) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!guest) throw new Error("Packaged website did not load.");
    await guest.waitForFunction(() => typeof window.fixture === "object");
    await guest.evaluate(() => window.fixture.seed("packaged-user"));
    const position = await guest.locator("#logout").boundingBox();
    await shell
      .getByRole("button", { name: "Pick an element", exact: true })
      .click();
    await shell.waitForFunction(
      async () => (await window.qa.state()).locator.picking,
    );
    await app.evaluate(
      async ({ webContents }, { website, position }) => {
        const wc = webContents
          .getAllWebContents()
          .find((wc) => wc.getURL() === website);
        const x = Math.round(position.x + position.width / 2);
        const y = Math.round(position.y + position.height / 2);
        wc.sendInputEvent({ type: "mouseMove", x, y });
        await new Promise((resolve) => setTimeout(resolve, 80));
        wc.sendInputEvent({
          type: "mouseDown",
          button: "left",
          clickCount: 1,
          x,
          y,
        });
        wc.sendInputEvent({
          type: "mouseUp",
          button: "left",
          clickCount: 1,
          x,
          y,
        });
      },
      { website, position },
    );
    await shell.locator("#locator-code").waitFor();
    const locator = await shell.locator("#locator-code").textContent();
    if (!locator.includes('name: "Sign out"'))
      throw new Error("Packaged locator picker returned the wrong element.");
    if (
      (await guest.evaluate(() => window.fixture.read())).local !==
      "packaged-user"
    )
      throw new Error("Picking activated the selected element.");
    await shell
      .getByRole("button", { name: "API tester", exact: true })
      .click();
    await shell.getByLabel("API request URL").waitFor();
    await shell.getByLabel("API request URL").fill(`${fixture.url}/api/echo`);
    await shell.getByRole("button", { name: "Send request" }).click();
    await shell.waitForFunction(() =>
      document
        .querySelector(".response-body")
        ?.textContent.includes("packaged-user"),
    );
    const info = await shell.evaluate(() => window.qa.automation());
    await fs.access(fileURLToPath(info.adapterURL));
    if (process.argv.includes("--automation")) {
      await shell.waitForFunction(async () => {
        const info = await window.qa.automation();
        return (
          !!info.endpoint && info.targets.every((target) => !!target.targetId)
        );
      });
      const automation = await shell.evaluate(() => window.qa.automation());
      const adapter = require(fileURLToPath(automation.adapterURL));
      const talos = await adapter.connectTalos(chromium, automation.endpoint);
      try {
        if ((await talos.groups()).length !== 3)
          throw new Error("Packaged Playwright group mapping failed.");
      } finally {
        await talos.disconnect();
      }
      console.log(
        "Packaged Playwright adapter connected and disconnected successfully.",
      );
    }
    await fs.mkdir("artifacts", { recursive: true });
    await shell.screenshot({ path: "artifacts/talos-packaged.png" });
    console.log(
      "Packaged Talos verified: isolated groups, settings, real locator selection and authenticated API requests.",
    );
  } finally {
    if (app) await app.close();
    if (fixture) await fixture.close();
    await fs.rm(userData, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 300,
    });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
