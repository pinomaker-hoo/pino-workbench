import { contextBridge, ipcRenderer } from "electron";
import type { Bridge } from "../src/shared";
const bridge: Bridge = {
  api: {
    list: () => ipcRenderer.invoke("api:list"),
    save: (input) => ipcRenderer.invoke("api:save", input),
    remove: (id) => ipcRenderer.invoke("api:remove", id),
    run: (id) => ipcRenderer.invoke("api:run", id),
    cancel: () => ipcRenderer.invoke("api:cancel"),
    export: (id) => ipcRenderer.invoke("api:export", id),
    import: () => ipcRenderer.invoke("api:import"),
  },
  settings: () => ipcRenderer.invoke("settings"),
  saveProfile: (input) => ipcRenderer.invoke("profile:save", input),
  deleteProfile: (id) => ipcRenderer.invoke("profile:delete", id),
  testProfile: (id) => ipcRenderer.invoke("profile:test", id),
  issues: (jql) => ipcRenderer.invoke("issues", jql),
  pages: (title) => ipcRenderer.invoke("pages", title),
  repository: () => ipcRenderer.invoke("repository"),
  exportContext: (input) => ipcRenderer.invoke("export", input),
};
contextBridge.exposeInMainWorld("pino", bridge);
