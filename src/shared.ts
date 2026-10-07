export const CHROME_HEIGHT = 104;
export const FOOTER_HEIGHT = 24;
export const COLORS = [
  "#177e69",
  "#6378ca",
  "#c47c3f",
  "#b85d83",
  "#659447",
  "#548da3",
] as const;
export interface AccountInfo {
  id: string;
  name: string;
  color: string;
  persistent: boolean;
  resetting: boolean;
}
export interface TabInfo {
  id: string;
  accountId: string;
  kind: "web" | "inbox";
  title: string;
  url: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  error?: string;
  automationTargetId?: string;
}
export interface WorkspaceState {
  accounts: AccountInfo[];
  tabs: TabInfo[];
  activeTabId: string;
  toolsOpen?: boolean;
  settingsOpen?: boolean;
  appearance: Appearance;
  locator?: LocatorState;
}
export interface LocatorResult {
  tabId: string;
  accountId: string;
  url: string;
  code: string;
  css: string;
  tag: string;
  name: string;
  strategy: string;
  note: string;
}
export interface LocatorState {
  picking: boolean;
  tabId?: string;
  result?: LocatorResult;
  error?: string;
}
export interface Appearance {
  background: string;
  text: string;
  accent: string;
}
export const DEFAULT_APPEARANCE: Appearance = {
  background: "#000000",
  text: "#ffffff",
  accent: "#83dab7",
};
export type Command =
  | {
      type: "create-account";
      name: string;
      color: string;
      persistent: boolean;
      url: string;
      inboxURL?: string;
    }
  | { type: "rename-account"; accountId: string; name: string }
  | { type: "remove-account" | "reset-account"; accountId: string }
  | { type: "new-tab"; accountId: string; url?: string; kind?: "web" | "inbox" }
  | { type: "activate-tab" | "close-tab"; tabId: string }
  | { type: "navigate"; url: string }
  | {
      type:
        | "back"
        | "forward"
        | "reload"
        | "stop"
        | "devtools"
        | "browser-menu"
        | "screenshot";
    }
  | { type: "tools"; open: boolean }
  | { type: "locator-pick" | "locator-cancel" | "locator-copy" }
  | { type: "settings"; open: boolean }
  | { type: "appearance"; appearance: Appearance }
  | { type: "devtools-mode"; mode: "right" | "bottom" | "detach" }
  | { type: "tab-menu" | "duplicate-tab"; tabId: string }
  | { type: "reopen-tab" }
  | { type: "reorder-tab"; tabId: string; beforeTabId: string }
  | { type: "group-menu"; accountId: string }
  | { type: "zoom"; direction: "in" | "out" | "reset" }
  | { type: "find"; text: string; forward?: boolean }
  | { type: "stop-find" }
  | { type: "overlay"; open: boolean };
export interface APIRequest {
  accountId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  useSession: boolean;
}
export interface APIResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  duration: number;
  bytes: number;
  truncated: boolean;
}
export interface AutomationInfo {
  enabled: boolean;
  endpoint?: string;
  adapterURL: string;
  targets: {
    tabId: string;
    targetId?: string;
    groupId: string;
    groupName: string;
    kind: "web" | "inbox";
    url: string;
  }[];
}
export interface BrowserAPI {
  state(): Promise<WorkspaceState>;
  command(command: Command): Promise<void>;
  onState(callback: (state: WorkspaceState) => void): () => void;
  onShortcut(callback: (action: string) => void): () => void;
  request(request: APIRequest): Promise<APIResponse>;
  automation(): Promise<AutomationInfo>;
}
