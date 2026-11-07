import { contextBridge, ipcRenderer } from "electron";

const defaultServerUrl: string | null = ipcRenderer.sendSync("app:default-server-url");

contextBridge.exposeInMainWorld("desktop", {
  platform: process.platform,
  defaultServerUrl,
  loadConfig: () => ipcRenderer.invoke("config:load"),
  saveConfig: (patch: unknown) => ipcRenderer.invoke("config:save", patch),
  listScreens: () => ipcRenderer.invoke("screens:list"),
  selectScreen: (id: string) => ipcRenderer.invoke("screens:select", id),
  injectInput: (event: unknown) => ipcRenderer.send("input:inject", event),
  requestConsent: (info: unknown) => ipcRenderer.invoke("consent:request", info),
  sessionStarted: (info: unknown) => ipcRenderer.send("session:started", info),
  sessionEnded: () => ipcRenderer.send("session:ended"),
  onDisconnectRequest: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("session:disconnect-request", listener);
    return () => ipcRenderer.removeListener("session:disconnect-request", listener);
  },
  readClipboard: () => ipcRenderer.invoke("clipboard:read"),
  writeClipboard: (text: string) => ipcRenderer.invoke("clipboard:write", text),
  fileBegin: (name: string, size: number) => ipcRenderer.invoke("file:begin", name, size),
  fileChunk: (id: string, chunk: ArrayBuffer) => ipcRenderer.send("file:chunk", id, chunk),
  fileEnd: (id: string) => ipcRenderer.invoke("file:end", id),
  fileAbort: (id: string) => ipcRenderer.send("file:abort", id),
  getPermissions: () => ipcRenderer.invoke("permissions:get"),
  openPermissionSettings: (kind: "screen" | "accessibility") => ipcRenderer.invoke("permissions:open", kind),
});
