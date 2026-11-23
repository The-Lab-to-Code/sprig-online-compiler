import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("the desktop menu is hidden but remains available with Alt", async () => {
  const source = await readFile(new URL("../desktop/main.js", import.meta.url), "utf8");
  let created;
  class BrowserWindow {
    constructor(options) {
      this.options = options;
      this.webContents = {
        session: { setPermissionCheckHandler() {}, setPermissionRequestHandler() {} },
        setWindowOpenHandler() {}, on() {}
      };
      created = this;
    }
    setMenu(menu) { this.menu = menu; }
    setMenuBarVisibility(visible) { this.menuVisible = visible; }
    once() {}
    on() {}
    loadURL() { return Promise.resolve(); }
  }
  const electron = {
    app: { requestSingleInstanceLock: () => false, quit() {} },
    BrowserWindow, dialog: {}, Menu: { buildFromTemplate: template => template }, shell: {}
  };
  const context = vm.createContext({
    require(name) {
      if (name === "electron") return electron;
      if (name === "electron-updater") return { autoUpdater: { on() {} } };
      if (name === "./updates") return { setupUpdates: () => () => {} };
      return requireNode(name);
    }, console, URL
  });
  const { createRequire } = await import("node:module");
  const requireNode = createRequire(import.meta.url);
  vm.runInContext(source + '\ncreateWindow("http://127.0.0.1:3001/");', context);
  assert.equal(created.options.autoHideMenuBar, true);
  assert.equal(created.menuVisible, false);
  assert.equal(created.menu[0].label, "Sprig");
  assert.ok(created.menu[0].submenu.some(item => item.label === "Check for updates"));
});
