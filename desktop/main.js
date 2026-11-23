const { app, BrowserWindow, dialog, Menu, shell } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { autoUpdater } = require("electron-updater");
const { setupUpdates } = require("./updates");

let runner, window, pageUrl, updateStatus = "Checking for updates", installRequested = false, quitting = false;

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
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
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
  window.loadURL(url + "#editor").catch(error => {
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
