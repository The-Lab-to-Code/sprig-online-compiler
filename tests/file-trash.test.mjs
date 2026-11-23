import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const helpers = html.slice(html.indexOf("async function assertNameAvailable("), html.indexOf("async function openTab("));
const trash = html.slice(html.indexOf('const TRASH_NAME='), html.indexOf("async function listDir("));
assert.ok(helpers.includes("writeFileHandle") && trash.includes("restoreTrashItem"));

function missing() { return new DOMException("Not found", "NotFoundError"); }
class TestFile {
  constructor(name, bytes = "") { this.name = name; this.kind = "file"; this.bytes = new Blob([bytes]); this.version = 1; }
  async isSameEntry(other) { return this === other; }
  async getFile() {
    const file = new Blob([this.bytes]);
    Object.defineProperty(file, "lastModified", { value: this.version });
    return file;
  }
  async createWritable() {
    if (this.failWrite) throw new Error("Write denied");
    let data;
    return { write: async value => { data = new Blob([value]); }, close: async () => { this.bytes = data; this.version++; } };
  }
}
class TestDirectory {
  constructor(name) { this.name = name; this.kind = "directory"; this.children = new Map(); }
  async isSameEntry(other) { return this === other; }
  async *entries() { yield* this.children.entries(); }
  async getFileHandle(name, options = {}) {
    if (!this.children.has(name) && options.create) this.children.set(name, new TestFile(name));
    const entry = this.children.get(name);
    if (!entry) throw missing();
    if (entry.kind !== "file") throw new DOMException("Wrong type", "TypeMismatchError");
    return entry;
  }
  async getDirectoryHandle(name, options = {}) {
    if (!this.children.has(name) && options.create) this.children.set(name, new TestDirectory(name));
    const entry = this.children.get(name);
    if (!entry) throw missing();
    if (entry.kind !== "directory") throw new DOMException("Wrong type", "TypeMismatchError");
    return entry;
  }
  async removeEntry(name) { if (!this.children.delete(name)) throw missing(); }
  async resolve(target) {
    if (target === this) return [];
    for (const [name, entry] of this.children) {
      if (entry === target) return [name];
      if (entry.kind === "directory") {
        const path = await entry.resolve(target);
        if (path) return [name, ...path];
      }
    }
    return null;
  }
}

function editor(root, confirm = () => true) {
  const messages = [], list = { textContent: "" };
  const context = vm.createContext({
    folderHandle: root, trashBusy: false, tabs: [], pendingWrites: new WeakMap(),
    crypto: { randomUUID }, confirm, alert: message => messages.push({ message, type: "alert" }), Uint8Array,
    line: (message, type) => messages.push({ message, type }),
    $: () => list, renderTabs() {}, renderOpen() {}, listDir: async () => {},
    closeTab(index) { context.tabs.splice(index, 1); },
    fileChangeBlocked: () => false
  });
  vm.runInContext(helpers + trash + "\nrenderTrash=async()=>{};", context);
  return { context, messages, list, run: source => vm.runInContext(source, context) };
}
async function backup(root) {
  const trash = await root.getDirectoryHandle(".sprig-trash");
  return [...trash.children.values()].find(entry => entry.kind === "directory");
}

test("cancelling deletion or having unsaved edits leaves the file untouched", async () => {
  const root = new TestDirectory("root"), file = new TestFile("a.js", "original");
  root.children.set(file.name, file);
  const cancelled = editor(root, () => false);
  cancelled.context.file = file;
  await cancelled.run('deleteTreeEntry(folderHandle,file,"a.js",{},0)');
  assert.equal(root.children.get("a.js"), file);
  assert.equal(root.children.has(".sprig-trash"), false);
  const dirty = editor(root);
  dirty.context.file = file;
  dirty.context.tabs.push({ handle: file, dirty: true });
  await dirty.run('deleteTreeEntry(folderHandle,file,"a.js",{},0)');
  assert.equal(root.children.get("a.js"), file);
  assert.match(dirty.messages[0].message, /Save or close modified files/);
});

test("a folder is backed up and restored with its binary contents", async () => {
  const root = new TestDirectory("root"), folder = new TestDirectory("assets");
  folder.children.set("blob.bin", new TestFile("blob.bin", new Uint8Array([0, 255, 42])));
  root.children.set(folder.name, folder);
  const { context, run } = editor(root);
  context.folder = folder;
  await run('deleteTreeEntry(folderHandle,folder,"assets",{},0)');
  assert.equal(root.children.has("assets"), false);
  context.backup = await backup(root);
  context.info = await run("readTrashItem(backup)");
  await run("restoreTrashItem(backup,info)");
  const restored = await (await root.getDirectoryHandle("assets")).getFileHandle("blob.bin");
  assert.deepEqual([...new Uint8Array(await (await restored.getFile()).arrayBuffer())], [0, 255, 42]);
  assert.equal((await run("readTrashItem(backup)")).restored, true);
  assert.ok(context.backup.children.has("content"));
});

test("restore refuses a collision and keeps the backup", async () => {
  const root = new TestDirectory("root"), file = new TestFile("a.js", "old");
  root.children.set(file.name, file);
  const { context, run, list } = editor(root);
  context.file = file;
  await run('deleteTreeEntry(folderHandle,file,"a.js",{},0)');
  context.backup = await backup(root);
  context.info = await run("readTrashItem(backup)");
  const replacement = new TestFile("a.js", "new");
  root.children.set("a.js", replacement);
  await run("restoreTrashItem(backup,info)");
  assert.equal(await (await replacement.getFile()).text(), "new");
  assert.match(list.textContent, /already exists/);
  assert.equal((await run("readTrashItem(backup)")).restored, false);
});

test("a failed backup or a changed source does not delete the original", async () => {
  for (const failure of ["write", "changed"]) {
    const root = new TestDirectory("root"), file = new TestFile("a.js", "old");
    root.children.set(file.name, file);
    const { context, run, messages } = editor(root);
    context.file = file;
    if (failure === "write") {
      await run("trashDirectory(true)");
      await run('writeFileHandle=async()=>{throw new Error("Write denied")}');
    } else {
      const original = file.getFile.bind(file);
      let reads = 0;
      file.getFile = async () => {
        if (++reads === 2) { file.bytes = new Blob(["new"]); file.version++; }
        return original();
      };
    }
    await run('deleteTreeEntry(folderHandle,file,"a.js",{},0)');
    assert.equal(root.children.get("a.js"), file);
    assert.match(messages.at(-1).message, failure === "write" ? /Write denied/ : /changed/);
  }
});

test("deleting an open file uses its workspace path, including nested files", async () => {
  const root = new TestDirectory("root"), folder = new TestDirectory("nested");
  const file = new TestFile("a.js", "old");
  root.children.set(folder.name, folder);
  folder.children.set(file.name, file);
  const { context, run } = editor(root);
  context.tabs.push({ name: file.name, handle: file, dirty: false });
  await run("deleteOpenEditor(tabs[0])");
  assert.equal(folder.children.has("a.js"), false);
  assert.equal(context.tabs.length, 0);
  assert.ok(await backup(root));
});

test("deleting an open file outside the workspace reports how to enable deletion", async () => {
  const { context, run, messages } = editor(new TestDirectory("root"));
  const file = new TestFile("outside.js", "kept");
  context.tabs.push({ name: file.name, handle: file, dirty: false });
  await run("deleteOpenEditor(tabs[0])");
  assert.equal(await (await file.getFile()).text(), "kept");
  assert.equal(context.tabs.length, 1);
  assert.match(messages.at(-1).message, /Open the folder containing this file/);
});

test("Explorer rename preserves binary data and blocks unsaved open files", async () => {
  const renameCode = html.slice(html.indexOf("async function renameFileInDirectory("), html.indexOf("const TRASH_NAME="));
  const root = new TestDirectory("root"), file = new TestFile("old.bin", new Uint8Array([0, 255, 42]));
  root.children.set(file.name, file);
  const { context, run, messages } = editor(root);
  Object.assign(context, {
    file, extLang: () => "js", active: -1,
    askFileName: async () => ({ name: "new.bin", lang: "js" }),
    activate() {}
  });
  vm.runInContext(renameCode, context);
  context.tabs.push({ handle: file, dirty: true });
  await run('renameTreeFile(folderHandle,file,"old.bin",{},0)');
  assert.equal(root.children.get("old.bin"), file);
  assert.match(messages.at(-1).message, /Save or close modified files/);
  context.tabs[0].dirty = false;
  await run('renameTreeFile(folderHandle,file,"old.bin",{},0)');
  const renamed = await root.getFileHandle("new.bin");
  assert.deepEqual([...new Uint8Array(await (await renamed.getFile()).arrayBuffer())], [0, 255, 42]);
  assert.equal(root.children.has("old.bin"), false);
  assert.equal(context.tabs[0].handle, renamed);
});
