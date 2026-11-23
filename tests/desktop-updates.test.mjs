import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { setupUpdates } = require("../desktop/updates.js");

function harness(responses = []) {
  const updater = new EventEmitter();
  const dialogs = [], statuses = [];
  updater.downloadUpdate = async () => { updater.downloads++; };
  updater.quitAndInstall = () => { updater.installs++; };
  updater.downloads = updater.installs = 0;
  const dialog = { showMessageBox: async options => {
    dialogs.push(options);
    return { response: responses.shift() ?? 1 };
  } };
  const check = setupUpdates({ updater, dialog, setStatus: status => statuses.push(status), packaged: true });
  return { updater, check, dialogs, statuses };
}

test("available updates require consent to download and again to restart", async () => {
  const { updater, dialogs, statuses } = harness([0, 1, 0]);
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  updater.emit("update-available", { version: "1.1.0" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(updater.downloads, 1);
  updater.emit("update-downloaded", { version: "1.1.0" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(updater.installs, 0);
  assert.match(dialogs[1].detail, /Save your work/);
  updater.emit("update-downloaded", { version: "1.1.0" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(updater.installs, 1);
  assert.match(statuses.at(-1), /Update ready/);
});

test("declining an available update does not download it", async () => {
  const { updater } = harness([1]);
  updater.emit("update-available", { version: "1.1.0" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(updater.downloads, 0);
});

test("installation is delegated so the desktop can close its editor safely", async () => {
  const updater = new EventEmitter();
  let installs = 0;
  setupUpdates({ updater, dialog: { showMessageBox: async () => ({ response: 0 }) },
    setStatus: () => {}, packaged: true, installUpdate: () => { installs++; } });
  updater.emit("update-downloaded", { version: "1.1.0" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(installs, 1);
});

test("a deferred update is not repeatedly prompted, but a manual check can offer it again", async () => {
  const { updater, check, dialogs } = harness([1, 1]);
  updater.checkForUpdates = async () => {
    updater.emit("update-available", { version: "1.1.0" });
    return { isUpdateAvailable: true };
  };
  await check();
  await new Promise(resolve => setImmediate(resolve));
  await check();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dialogs.length, 1);
  await check(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dialogs.length, 2);
});

test("manual update checks report current versions and errors", async () => {
  const { updater, check, dialogs, statuses } = harness();
  updater.checkForUpdates = async () => ({ isUpdateAvailable: false });
  await check(true);
  assert.match(dialogs.at(-1).message, /up to date/);
  updater.checkForUpdates = async () => { throw new Error("network unavailable"); };
  await check(true);
  assert.match(dialogs.at(-1).detail, /network unavailable/);
  assert.equal(statuses.at(-1), "Update check failed");
});
