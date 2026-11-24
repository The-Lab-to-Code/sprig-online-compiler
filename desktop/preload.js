const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sprigDesktop", {
  getPreferences: () => ipcRenderer.sendSync("sprig:preferences:get"),
  updatePreferences: changes => ipcRenderer.invoke("sprig:preferences:update", changes)
});
