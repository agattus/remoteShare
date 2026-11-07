import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("banner", {
  disconnect: () => ipcRenderer.send("banner:disconnect"),
});
