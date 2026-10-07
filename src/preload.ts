import { contextBridge, ipcRenderer } from "electron";
import type { BrowserAPI, Command, WorkspaceState } from "./shared";
const api: BrowserAPI = {
  state: () => ipcRenderer.invoke("qa:state"),
  command: (command: Command) => ipcRenderer.invoke("qa:command", command),
  request: (request) => ipcRenderer.invoke("qa:request", request),
  automation: () => ipcRenderer.invoke("qa:automation"),
  onState: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: WorkspaceState,
    ) => callback(state);
    ipcRenderer.on("qa:state-changed", listener);
    return () => ipcRenderer.removeListener("qa:state-changed", listener);
  },
  onShortcut: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, action: string) =>
      callback(action);
    ipcRenderer.on("qa:shortcut", listener);
    return () => ipcRenderer.removeListener("qa:shortcut", listener);
  },
};
contextBridge.exposeInMainWorld("qa", api);
