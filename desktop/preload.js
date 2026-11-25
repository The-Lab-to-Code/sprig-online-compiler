const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sprigDesktop", {
  getPreferences: () => ipcRenderer.sendSync("sprig:preferences:get"),
  updatePreferences: changes => ipcRenderer.invoke("sprig:preferences:update", changes),
  openFolder: () => ipcRenderer.invoke("sprig:desktop:open-folder"),
  openFile: () => ipcRenderer.invoke("sprig:desktop:open-file"),
  readDir: directory => ipcRenderer.invoke("sprig:desktop:read-dir", directory),
  readFile: file => ipcRenderer.invoke("sprig:desktop:read-file", file),
  writeFile: (file, content) => ipcRenderer.invoke("sprig:desktop:write-file", file, content),
  makeDir: directory => ipcRenderer.invoke("sprig:desktop:make-dir", directory),
  removePath: target => ipcRenderer.invoke("sprig:desktop:remove-path", target),
  renamePath: (target, destination) => ipcRenderer.invoke("sprig:desktop:rename-path", target, destination)
});
