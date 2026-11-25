const { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { autoUpdater } = require("electron-updater");
const { setupUpdates } = require("./updates");
const { createPreferences } = require("./preferences");

let runner, window, pageUrl, updateStatus = "Checking for updates", installRequested = false, quitting = false;
let preferences;

function iconForTheme(theme) {
  return path.join(__dirname, theme === "dark" ? "icon-dark.png" : "icon.png");
}

function installUpdate() {
  if (!window) return autoUpdater.quitAndInstall();
  installRequested = true;
  window.close();
}

function updateMenu() {
  if (!window) return;
  window.setMenu(Menu.buildFromTemplate([{
    label: "Sprig",
    submenu: [
      { label: updateStatus, enabled: false },
      { label: "Check for updates", click: () => checkForUpdates(true) },
      { type: "separator" },
      { label: "Quit Sprig", click: () => window.close() }
    ]
  }]));
  window.setMenuBarVisibility(false);
}

const checkForUpdates = setupUpdates({
  updater: autoUpdater, dialog, packaged: app.isPackaged, installUpdate,
  setStatus: status => { updateStatus = status; updateMenu(); }
});

autoUpdater.on("error", error => {
  if (installRequested && !window) {
    installRequested = false;
    dialog.showErrorBox("Could not install Sprig update", error.message);
    createWindow(pageUrl);
  }
});

function createWindow(url) {
  const origin = new URL(url).origin;
  window = new BrowserWindow({
    width: 1440, height: 900, minWidth: 800, minHeight: 600,
    title: "Sprig", show: false, autoHideMenuBar: true,
    icon: iconForTheme(preferences ? (preferences.get().theme || (nativeTheme.shouldUseDarkColors ? "dark" : "light")) : null),
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true,
      preload: path.join(__dirname, "preload.js") }
  });
  const contents = window.webContents;
  contents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin) =>
    webContents === contents && requestingOrigin === origin &&
      (permission === "fileSystem" || permission === "notifications"));
  contents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    let requestOrigin;
    try { requestOrigin = new URL(details.requestingUrl).origin; } catch { requestOrigin = ""; }
    callback(webContents === contents && requestOrigin === origin &&
      (permission === "fileSystem" || permission === "notifications"));
  });
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event, target) => {
    const destination = new URL(target);
    if (destination.origin === origin && ["/", "/index.html"].includes(destination.pathname)) return;
    event.preventDefault();
    if (["http:", "https:"].includes(destination.protocol)) {
      shell.openExternal(destination.href).catch(error => dialog.showErrorBox("Could not open link", error.message));
    }
  });
  contents.on("will-prevent-unload", event => {
    const choice = dialog.showMessageBoxSync(window, {
      type: "warning", title: "Unsaved changes",
      message: "Discard unsaved changes and close Sprig?",
      buttons: ["Keep editing", "Discard and close"], defaultId: 0, cancelId: 0
    });
    if (choice === 1) event.preventDefault();
    else installRequested = false;
  });
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    window = null;
    if (installRequested) autoUpdater.quitAndInstall();
  });
  updateMenu();
  window.loadURL(url).catch(error => {
    dialog.showErrorBox("Could not open Sprig", error.message);
    app.quit();
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  app.on("window-all-closed", () => { if (!installRequested) app.quit(); });
  app.on("will-quit", () => {
    quitting = true;
    if (runner && runner.exitCode === null) runner.kill();
  });
  app.whenReady().then(() => {
    const dataDir = app.getPath("userData");
    fs.mkdirSync(dataDir, { recursive: true });
    preferences = createPreferences(dataDir);
    const validSender = event => window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;
    ipcMain.on("sprig:preferences:get", event => {
      event.returnValue = validSender(event) ? preferences.get() : null;
    });
    ipcMain.handle("sprig:preferences:update", (event, changes) => {
      if (!validSender(event)) throw new Error("Invalid preferences request.");
      const result = preferences.update(changes);
      window.setIcon(iconForTheme(result.theme));
      return result;
    });
    ipcMain.handle("sprig:desktop:open-folder", async event => {
      if (!validSender(event)) throw new Error("Invalid folder request.");
      const result = await dialog.showOpenDialog(window, { title: "Open folder", properties: ["openDirectory"] });
      return result.canceled ? null : result.filePaths[0];
    });
    ipcMain.handle("sprig:desktop:open-file", async event => {
      if (!validSender(event)) throw new Error("Invalid file request.");
      const result = await dialog.showOpenDialog(window, { title: "Open file", properties: ["openFile"] });
      if (result.canceled) return null;
      const filePath = result.filePaths[0];
      return { name: path.basename(filePath), path: filePath, content: fs.readFileSync(filePath, "utf8") };
    });
    ipcMain.handle("sprig:desktop:read-dir", (event, directory) => {
      if (!validSender(event)) throw new Error("Invalid directory request.");
      return fs.readdirSync(directory, { withFileTypes: true })
        .map(entry => ({ name: entry.name, kind: entry.isDirectory() ? "directory" : "file",
          path: path.join(directory, entry.name) }));
    });
    ipcMain.handle("sprig:desktop:read-file", (event, filePath) => {
      if (!validSender(event)) throw new Error("Invalid file request.");
      return fs.readFileSync(filePath, "utf8");
    });
    ipcMain.handle("sprig:desktop:write-file", (event, filePath, content) => {
      if (!validSender(event)) throw new Error("Invalid file write.");
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, "utf8");
      return true;
    });
    ipcMain.handle("sprig:desktop:make-dir", (event, directory) => {
      if (!validSender(event)) throw new Error("Invalid directory request.");
      fs.mkdirSync(directory, { recursive: true });
      return true;
    });
    ipcMain.handle("sprig:desktop:remove-path", (event, target) => {
      if (!validSender(event)) throw new Error("Invalid removal request.");
      fs.rmSync(target, { recursive: true, force: true });
      return true;
    });
    ipcMain.handle("sprig:desktop:rename-path", (event, target, destination) => {
      if (!validSender(event)) throw new Error("Invalid rename request.");
      fs.renameSync(target, destination);
      return true;
    });
    runner = spawn(process.execPath, [path.join(app.getAppPath(), "sprig-runner.js"), "--desktop"], {
      cwd: app.getAppPath(), env: { ...process.env, ELECTRON_RUN_AS_NODE: "1",
        SPRIG_FLIX_PATH: path.join(dataDir, "flix.jar") },
      windowsHide: true, stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    runner.stdout.on("data", chunk => {
      output = (output + chunk.toString()).slice(-8192);
      const match = output.match(/Sprig local runner listening on (http:\/\/127\.0\.0\.1:\d+\/)/);
      if (match && !pageUrl) { pageUrl = match[1]; createWindow(pageUrl); }
    });
    runner.stderr.on("data", chunk => console.error("Sprig runner:", chunk.toString()));
    runner.on("error", error => {
      dialog.showErrorBox("Could not start Sprig", error.message);
      app.quit();
    });
    runner.on("exit", (code, signal) => {
      if (!quitting) {
        dialog.showErrorBox("Sprig stopped", "The local runner exited (" + (signal || code) + ").");
        app.quit();
      }
    });
    checkForUpdates();
    setInterval(() => checkForUpdates(), 15 * 60 * 1000).unref();
  }).catch(error => {
    dialog.showErrorBox("Could not start Sprig", error.message);
    app.quit();
  });
}
