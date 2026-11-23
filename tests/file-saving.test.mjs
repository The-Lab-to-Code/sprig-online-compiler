import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const start = html.indexOf("async function writeFileHandle(");
const end = html.indexOf("async function createNewFile(", start);
assert.ok(start >= 0 && end > start, "File handling functions are missing");
const fileFunctions = html.slice(start, end);

function editor({ savePicker } = {}) {
  const messages = [], status = {};
  const context = vm.createContext({
    tabs: [], active: -1, code: { value: "" }, folderHandle: null,
    hasOpenPicker: false, hasSavePicker: !!savePicker, window: {}, fileChangeBlocked: () => false,
    L: { js: { ext: "js" } }, extLang: () => "js",
    renderTabs: () => {}, renderOpen: () => {},
    $: () => status,
    line: (message, type) => messages.push({ message, type }),
    showSaveFilePicker: savePicker
  });
  context.activate = index => {
    if (context.active >= 0) context.tabs[context.active].text = context.code.value;
    context.active = index;
    context.code.value = context.tabs[index].text;
  };
  context.newTab = (name, lang, text, handle, directory) => {
    context.tabs.push({ name, lang, text, handle: handle || null, directory: directory || null, dirty: false });
    context.activate(context.tabs.length - 1);
  };
  vm.runInContext(fileFunctions, context);
  return { context, status, messages, run: source => vm.runInContext(source, context) };
}

function fileHandle(name, initial) {
  let contents = initial;
  return {
    name,
    get contents() { return contents; },
    async createWritable() {
      let next;
      return {
        async write(text) { next = text; },
        async close() { contents = next; }
      };
    }
  };
}

test("reopening a folder file selects the existing tab and Save overwrites it", async () => {
  const { context, run } = editor();
  const original = fileHandle("example.js", "old");
  original.isSameEntry = async other => other.key === "example";
  context.original = original;
  context.secondHandle = { key: "example" };
  context.directory = {};
  await run('openTab("example.js","old",original,directory)');
  context.code.value = "edited";
  context.tabs[0].dirty = true;
  await run('openTab("example.js","old",secondHandle,directory)');
  assert.equal(context.tabs.length, 1);
  assert.equal(context.code.value, "edited");
  await run("save()");
  assert.equal(original.contents, "edited");
  assert.equal(context.tabs[0].dirty, false);
});

test("editing during an in-progress save keeps the later changes dirty", async () => {
  const { context, status, run } = editor();
  let finish;
  const handle = {
    name: "example.js",
    async createWritable() {
      return { write: async () => {}, close: () => new Promise(resolve => { finish = resolve; }) };
    }
  };
  context.handle = handle;
  await run('openTab("example.js","old",handle)');
  context.code.value = "first edit";
  context.tabs[0].dirty = true;
  const saving = run("save()");
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  context.code.value = "later edit";
  finish();
  await saving;
  assert.equal(context.tabs[0].text, "later edit");
  assert.equal(context.tabs[0].dirty, true);
  assert.match(status.textContent, /new changes unsaved/);
});

test("repeated saves write in order so an older save cannot overwrite a newer one", async () => {
  const { context, run } = editor();
  let release, contents = "", started = 0;
  context.handle = {
    name: "example.js",
    async createWritable() {
      const current = ++started;
      let next;
      return {
        async write(text) { next = text; },
        async close() {
          if (current === 1) await new Promise(resolve => { release = resolve; });
          contents = next;
        }
      };
    }
  };
  await run('openTab("example.js","old",handle)');
  context.code.value = "first edit";
  context.tabs[0].dirty = true;
  const first = run("save()");
  while (!release) await new Promise(resolve => setImmediate(resolve));
  context.code.value = "second edit";
  const second = run("save()");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, 1);
  release();
  await Promise.all([first, second]);
  assert.equal(contents, "second edit");
  assert.equal(context.tabs[0].dirty, false);
});

test("Save All updates existing handles even without file picker support", async () => {
  const { context, run } = editor();
  context.handle = fileHandle("original.js", "old");
  await run('openTab("original.js","old",handle);');
  context.code.value = "changed";
  context.tabs[0].dirty = true;
  await run('openTab("Untitled-1","new",null)');
  context.tabs[1].dirty = true;
  context.downloads = [];
  run("downloadFile=(tab,text,name)=>downloads.push({name,text})");
  await run("saveAll()");
  assert.equal(context.handle.contents, "changed");
  assert.equal(context.tabs[0].dirty, false);
  assert.equal(context.downloads.length, 1);
  assert.equal(context.downloads[0].text, "new");
});

test("Save All skips untouched untitled tabs and clean existing files", async () => {
  const { context, run } = editor();
  context.cleanHandle = fileHandle("clean.js", "changed externally");
  context.changedHandle = fileHandle("changed.js", "old");
  context.folderHandle = {
    async *entries() { throw new Error("No new file should be created"); },
    async getFileHandle() { throw new Error("No new file should be created"); }
  };
  await run('openTab("clean.js","stale",cleanHandle)');
  await run('openTab("changed.js","old",changedHandle)');
  context.code.value = "edited";
  context.tabs[1].dirty = true;
  await run('openTab("Untitled-1","starter",null)');
  await run("saveAll()");
  assert.equal(context.cleanHandle.contents, "changed externally");
  assert.equal(context.changedHandle.contents, "edited");
  assert.equal(context.tabs[2].handle, null);
});

test("a denied write leaves the original tab dirty and reports the error", async () => {
  const { context, messages, run } = editor();
  context.handle = { name: "example.js", createWritable: async () => { throw new Error("Permission denied"); } };
  await run('openTab("example.js","old",handle)');
  context.code.value = "edited";
  context.tabs[0].dirty = true;
  await run("save()");
  assert.equal(context.tabs[0].dirty, true);
  assert.match(messages[0].message, /Permission denied/);
});

test("a failed Save As does not replace the original file handle", async () => {
  const original = fileHandle("original.js", "old");
  const broken = { name: "copy.js", createWritable: async () => { throw new Error("Permission denied"); } };
  const { context, messages, run } = editor({ savePicker: async () => broken });
  context.original = original;
  await run('openTab("original.js","old",original)');
  context.code.value = "edited";
  context.tabs[0].dirty = true;
  await run("saveAs()");
  assert.equal(context.tabs[0].handle, original);
  assert.equal(context.tabs[0].name, "original.js");
  assert.equal(context.tabs[0].dirty, true);
  assert.match(messages[0].message, /Permission denied/);
});
