import type { WebContents } from "electron";
import type { LocatorState, TabInfo } from "./shared";

// Runs in a Chromium isolated world: no preload, page globals, or Node access.
function describeElement(this: Element) {
  if (this.nodeType !== 1 || this.ownerDocument !== document) return null;
  const quote = (value: string) => JSON.stringify(value);
  const bounded = (value: string | null) => (value || "").slice(0, 1000);
  let work = 0;
  const deadline = performance.now() + 1000;
  const budget = () => {
    if (++work > 50000 || performance.now() > deadline)
      throw new Error(
        "This page is too large to inspect safely. Use Playwright’s code generator or add a test ID.",
      );
  };
  function path(element: Element): string {
    budget();
    const root = element.getRootNode() as Document | ShadowRoot;
    const shadow = root.nodeType === 11 ? (root as ShadowRoot) : undefined;
    if (shadow?.mode === "closed")
      throw new Error("Playwright cannot pierce this closed shadow root.");
    const unique = (selector: string) =>
      root.querySelectorAll(selector).length === 1;
    let selector = "";
    if (element.id && unique(`#${CSS.escape(element.id)}`))
      selector = `#${CSS.escape(element.id)}`;
    for (const attr of ["data-testid", "data-test", "data-qa"]) {
      if (selector) break;
      const value = element.getAttribute(attr);
      const candidate = `[${attr}=${quote(value || "")}]`;
      if (value && unique(candidate)) selector = candidate;
    }
    if (!selector) {
      const parts: string[] = [];
      let node: Element | null = element;
      while (node) {
        budget();
        const tag = CSS.escape(node.localName);
        const siblings = node.parentElement
          ? [...node.parentElement.children].filter(
              (child) => child.localName === node!.localName,
            )
          : [node];
        parts.unshift(
          tag +
            (siblings.length > 1
              ? `:nth-of-type(${siblings.indexOf(node) + 1})`
              : ""),
        );
        selector = parts.join(" > ");
        if (unique(selector)) break;
        node = node.parentElement;
      }
    }
    return shadow ? `${path(shadow.host)} >> ${selector}` : selector;
  }
  const css = path(this);
  const testId = bounded(this.getAttribute("data-testid"));
  let testIdCount = 0;
  const roots: (Document | ShadowRoot)[] = [document];
  while (testId && roots.length) {
    const walker = document.createTreeWalker(
      roots.pop()!,
      NodeFilter.SHOW_ELEMENT,
    );
    let element: Element | null;
    while ((element = walker.nextNode() as Element | null)) {
      budget();
      if (testId && element.getAttribute("data-testid") === testId)
        testIdCount++;
      if (element.shadowRoot) roots.push(element.shadowRoot);
    }
  }
  return {
    css,
    testId,
    testIdCount,
    tag: this.localName,
    text: bounded((this.textContent || "").trim().replace(/\s+/g, " ")),
  };
}

interface FrameTree {
  frame: { id: string; parentId?: string };
  childFrames?: FrameTree[];
}
export class LocatorPicker {
  private status: LocatorState = { picking: false };
  private contents?: WebContents;
  private cleanup?: () => void;
  private selecting = false;
  private generation = 0;
  constructor(private changed: () => void) {}
  state(): LocatorState {
    return {
      ...this.status,
      result: this.status.result && { ...this.status.result },
    };
  }
  cancel(error?: string) {
    if (!this.contents) return;
    const wc = this.contents;
    this.contents = undefined;
    this.generation++;
    this.cleanup?.();
    this.cleanup = undefined;
    if (!wc.isDestroyed() && wc.debugger.isAttached()) wc.debugger.detach();
    this.status = { ...this.status, picking: false, error };
    this.changed();
  }
  invalidate(tabId: string) {
    if (this.status.tabId !== tabId && this.status.result?.tabId !== tabId)
      return;
    this.cancel();
    this.status = { picking: false };
    this.changed();
  }
  async start(wc: WebContents, tab: TabInfo) {
    this.cancel();
    if (wc.isDevToolsOpened())
      throw new Error(
        "Close this tab’s DevTools before using the locator picker.",
      );
    if (wc.debugger.isAttached())
      throw new Error(
        "This page is being inspected by another tool. Try again when it finishes.",
      );
    wc.debugger.attach("1.3");
    this.contents = wc;
    const generation = ++this.generation;
    let selectionTimeout: ReturnType<typeof setTimeout> | undefined;
    this.selecting = false;
    this.status = { picking: true, tabId: tab.id };
    const detached = () =>
      this.cancel("Locator picking stopped. Try picking again.");
    const navigating = (details: { isMainFrame: boolean }) => {
      if (details.isMainFrame) this.cancel();
    };
    const message = (
      _event: Electron.Event,
      method: string,
      params: any,
      sessionId: string,
    ) => {
      if (method === "Overlay.inspectModeCanceled" && !this.selecting)
        this.cancel();
      if (method === "Overlay.inspectNodeRequested" && !this.selecting) {
        this.selecting = true;
        selectionTimeout = setTimeout(() => {
          if (this.contents === wc && this.generation === generation)
            this.cancel(
              "Element inspection timed out. Try a simpler element or Playwright’s code generator.",
            );
        }, 10000);
        void this.select(
          wc,
          tab,
          params.backendNodeId,
          generation,
          sessionId,
        ).catch((error) => {
          if (this.contents === wc && this.generation === generation)
            this.cancel(String(error).replace(/^Error: /, ""));
        });
      }
    };
    wc.debugger.on("detach", detached);
    wc.debugger.on("message", message);
    wc.on("did-start-navigation", navigating);
    this.cleanup = () => {
      clearTimeout(selectionTimeout);
      wc.debugger.removeListener("detach", detached);
      wc.debugger.removeListener("message", message);
      wc.removeListener("did-start-navigation", navigating);
    };
    try {
      await wc.debugger.sendCommand("DOM.enable");
      await wc.debugger.sendCommand("Overlay.enable");
      await wc.debugger.sendCommand("Overlay.setInspectMode", {
        mode: "searchForNode",
        highlightConfig: {
          showInfo: true,
          contentColor: { r: 131, g: 218, b: 183, a: 0.25 },
          borderColor: { r: 131, g: 218, b: 183, a: 0.9 },
        },
      });
      if (this.contents !== wc || this.generation !== generation) return;
      wc.focus();
      this.changed();
    } catch (error) {
      if (this.contents === wc && this.generation === generation) this.cancel();
      throw error;
    }
  }
  private async select(
    wc: WebContents,
    tab: TabInfo,
    backendNodeId: number,
    generation: number,
    sessionId?: string,
  ) {
    const send = (method: string, params: object = {}) =>
      wc.debugger.sendCommand(method, params, sessionId || undefined);
    await send("Overlay.setInspectMode", { mode: "none", highlightConfig: {} });
    const { frameTree } = (await send("Page.getFrameTree")) as {
      frameTree: FrameTree;
    };
    const frames: FrameTree[] = [];
    const visit = (node: FrameTree) => {
      frames.push(node);
      node.childFrames?.forEach(visit);
    };
    visit(frameTree);
    let selected: any;
    let frame: FrameTree | undefined;
    let objectId = "";
    for (const candidate of frames) {
      try {
        const world = await send("Page.createIsolatedWorld", {
          frameId: candidate.frame.id,
          worldName: "talos-locator",
        });
        const node = await send("DOM.resolveNode", {
          backendNodeId,
          executionContextId: world.executionContextId,
        });
        const result = await send("Runtime.callFunctionOn", {
          objectId: node.object.objectId,
          functionDeclaration: describeElement.toString(),
          returnByValue: true,
        });
        if (result.exceptionDetails)
          throw new Error(
            result.exceptionDetails.exception?.description ||
              "Could not inspect this element.",
          );
        if (!result.result.value) continue;
        selected = result.result.value;
        frame = candidate;
        objectId = node.object.objectId;
        break;
      } catch (error) {
        if (/closed shadow|too large to inspect/.test(String(error)))
          throw error;
        // A node from another frame cannot always be wrapped in this context.
      }
    }
    if (!selected || !frame)
      throw new Error(
        "Could not read this element. Try again after the page finishes changing. Cross-process frames may need Playwright’s code generator.",
      );
    let prefix = "page";
    const framePaths: string[] = [];
    let current = frame;
    while (current.frame.id !== frameTree.frame.id) {
      const parent = frames.find(
        (item) => item.frame.id === current.frame.parentId,
      );
      if (!parent) throw new Error("Could not identify the containing frame.");
      const owner = await send("DOM.getFrameOwner", {
        frameId: current.frame.id,
      });
      const world = await send("Page.createIsolatedWorld", {
        frameId: parent.frame.id,
        worldName: "talos-locator",
      });
      const node = await send("DOM.resolveNode", {
        backendNodeId: owner.backendNodeId,
        executionContextId: world.executionContextId,
      });
      const result = await send("Runtime.callFunctionOn", {
        objectId: node.object.objectId,
        functionDeclaration: describeElement.toString(),
        returnByValue: true,
      });
      if (!result.result.value?.css)
        throw new Error("Could not identify the containing iframe.");
      framePaths.unshift(result.result.value.css);
      current = parent;
    }
    for (const path of framePaths)
      prefix += `.frameLocator(${JSON.stringify(path)})`;
    let code = `${prefix}.locator(${JSON.stringify(selected.css)})`;
    let strategy = "CSS fallback";
    let name = selected.text;
    if (selected.testId && selected.testIdCount === 1) {
      code = `${prefix}.getByTestId(${JSON.stringify(selected.testId)})`;
      strategy = "Test ID";
      name = selected.testId;
    } else {
      try {
        const partial = await send("Accessibility.getPartialAXTree", {
          objectId,
          fetchRelatives: false,
        });
        const ax = partial.nodes.find((node: any) => !node.ignored);
        const role = ax?.role?.value;
        const accessibleName = ax?.name?.value;
        const supported = [
          "button",
          "link",
          "textbox",
          "checkbox",
          "radio",
          "combobox",
          "heading",
          "tab",
          "menuitem",
          "option",
          "switch",
          "img",
          "slider",
          "spinbutton",
          "searchbox",
        ];
        if (
          supported.includes(role) &&
          accessibleName &&
          accessibleName.length <= 1000
        ) {
          const tree = await send("Accessibility.getFullAXTree", {
            frameId: frame.frame.id,
          });
          const matches = tree.nodes.filter(
            (node: any) =>
              !node.ignored &&
              node.role?.value === role &&
              node.name?.value === accessibleName,
          );
          if (matches.length === 1) {
            code = `${prefix}.getByRole(${JSON.stringify(role)}, { name: ${JSON.stringify(accessibleName)}, exact: true })`;
            strategy = "Role and accessible name";
            name = accessibleName;
          }
        }
      } catch {
        /* CSS remains a deterministic fallback when AX inspection is unavailable. */
      }
    }
    if (
      this.contents !== wc ||
      this.generation !== generation ||
      wc.isDestroyed()
    )
      return;
    // Only bounded metadata reaches the trusted shell; never execute the locator string.
    if (code.length > 8192 || selected.css.length > 8192)
      throw new Error(
        "This locator is too long. Add a test ID to the element.",
      );
    this.status = {
      picking: false,
      tabId: tab.id,
      result: {
        tabId: tab.id,
        accountId: tab.accountId,
        url: tab.url,
        code,
        css: selected.css,
        tag: selected.tag,
        name: name.slice(0, 1000),
        strategy,
        note: "Suggested locator for the current DOM. Confirm it in your test; CSS paths can change as the page changes.",
      },
    };
    this.cancel();
    this.changed();
  }
}
