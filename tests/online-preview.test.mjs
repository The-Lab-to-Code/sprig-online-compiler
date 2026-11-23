import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const editor = await readFile(new URL("../index.html", import.meta.url), "utf8");
const data = editor.slice(editor.indexOf("const DATA="), editor.indexOf("const $=id=>"));

test("the online preview lists only browser modes and ignores a saved remote engine", () => {
  const provider = editor.slice(editor.indexOf("function selectedProvider()"), editor.indexOf("function providerUrl("));
  const context = vm.createContext({ previewMode: true, store: { get: () => "tio" } });
  vm.runInContext(data + provider + `
    globalThis.languages=ORDER.map(id=>({id,local:L[id].local}));
    globalThis.provider=selectedProvider();`, context);
  assert.deepEqual(Array.from(context.languages, language => language.id),
    ["js", "ts", "coffee", "py", "lua", "bf", "html", "md", "json"]);
  assert.ok(context.languages.every(language => language.local));
  assert.equal(context.provider, "auto");
});

test("preview file detection never chooses an unavailable language", () => {
  const detection = editor.slice(editor.indexOf("const EXT_LANG_ALIASES="), editor.indexOf("function validFileName("));
  const context = vm.createContext({ previewMode: true });
  vm.runInContext(data + detection, context);
  assert.equal(vm.runInContext('extLang("hello.mjs")', context), "js");
  assert.equal(vm.runInContext('extLang("hello.cpp")', context), undefined);
  assert.equal(vm.runInContext('extLang("hello.py")', context), "py");
});

test("download link uses the latest installer and falls back to the release page", async () => {
  const script = await readFile(new URL("../web/download.js", import.meta.url), "utf8");
  const fallback = "https://github.com/The-Lab-to-Code/sprig-online-compiler/releases/latest";
  async function run(fetch) {
    const link = { href: fallback }, status = {};
    const context = vm.createContext({
      fetch, document: { getElementById: id => id === "downloadLink" ? link : status },
      console: { error() {} }
    });
    vm.runInContext(script, context);
    await new Promise(resolve => setImmediate(resolve));
    return { link, status };
  }
  const url = "https://github.com/The-Lab-to-Code/sprig-online-compiler/releases/download/v1.2.3/Sprig-Setup-1.2.3.exe";
  const success = await run(async () => ({ ok: true, json: async () => ({
    tag_name: "v1.2.3", assets: [{ name: "Sprig-Setup-1.2.3.exe", browser_download_url: url }]
  }) }));
  assert.equal(success.link.href, url);
  assert.match(success.status.textContent, /v1\.2\.3/);
  const failure = await run(async () => ({ ok: false }));
  assert.equal(failure.link.href, fallback);
  assert.match(failure.status.textContent, /latest release/);
});
