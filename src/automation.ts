import { app, type WebContents } from "electron";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
export const automationEnabled = process.argv.includes("--qa-automation");
export function configureAutomation() {
  if (!automationEnabled) return;
  // Do not display an endpoint left by an earlier process before this server starts.
  rmSync(path.join(app.getPath("userData"), "DevToolsActivePort"), {
    force: true,
  });
  app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
  app.commandLine.appendSwitch("remote-debugging-port", "0");
}
export function automationEndpoint(): string | undefined {
  if (!automationEnabled) return;
  try {
    const port = Number(
      readFileSync(
        path.join(app.getPath("userData"), "DevToolsActivePort"),
        "utf8",
      ).split("\n")[0],
    );
    if (port > 0 && port <= 65535) return `http://127.0.0.1:${port}`;
  } catch {
    /* Chromium writes this file after its debugging server starts. */
  }
}
export async function targetId(
  contents: WebContents,
): Promise<string | undefined> {
  if (!automationEnabled || contents.isDestroyed()) return;
  let attached = false;
  try {
    if (contents.debugger.isAttached()) return;
    contents.debugger.attach("1.3");
    attached = true;
    const result = await contents.debugger.sendCommand("Target.getTargetInfo");
    return result.targetInfo.targetId;
  } catch {
    return undefined;
  } finally {
    if (attached && !contents.isDestroyed() && contents.debugger.isAttached())
      contents.debugger.detach();
  }
}
