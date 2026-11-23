import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const start = html.indexOf("const autoWandbox=");
const end = html.indexOf("const engineName=", start);
assert.ok(start >= 0 && end > start, "Auto engine selection is missing");
const autoCode = html.slice(start, end);
const runner = await readFile(new URL("../server/sprig-runner.js", import.meta.url), "utf8");

function selector(localPage = true) {
  const saved = new Map();
  const context = vm.createContext({
    localPage,
    store: { get: key => saved.get(key), set: (key, value) => saved.set(key, value) },
    console
  });
  vm.runInContext(autoCode, context);
  return {
    run: source => vm.runInContext(source, context),
    saved
  };
}

test("Auto consistently uses each language's displayed provider", () => {
  const { run, saved } = selector();
  run(`var browser={id:"js",rt:"@js",local:true,wandboxVersions:[{id:"node"}]};
    var engine={id:"c",rt:"c",wandboxVersions:[{id:"gcc"}],tioKey:"c",tioVersions:[{id:"c"}]};
    var tio={id:"ada",rt:"ada",tioOnly:true,tioKey:"ada",tioVersions:[{id:"ada"}]};
    var erlang={id:"erlang",rt:"erlang",tioOnly:true,wandboxVersions:[{id:"erlang"}],tioKey:"erlang",tioVersions:[{id:"erlang-escript"}]};`);
  assert.equal(run("autoChoice(browser)"), "browser");
  assert.equal(run("autoChoice(engine)"), "wandbox");
  assert.equal(run("autoChoice(tio)"), "tio");
  assert.equal(run("autoChoice(erlang)"), "tio");
  assert.equal(saved.has("sprig.auto.stats"), false);
});

test("Auto chooses without probing catalogs and does not change on catalog failures", () => {
  const { run } = selector(false);
  run(`var lang={id:"c",rt:"c",tioKey:"c",tioVersions:[{id:"c"}]};`);
  assert.equal(run("designatedProvider(lang)"), "wandbox");
  assert.equal(run("autoChoice(lang)"), "wandbox");
  assert.equal(run('autoChoice({id:"pwsh",rt:"powershell"})'), "tio");
  assert.equal(run('autoChoice({id:"flix",rt:"flix"})'), "local");
  assert.equal(run('autoChoice({id:"tsdeno",rt:"typescript"})'), null);
  assert.equal(run('autoChoice({id:"bqn",rt:"bqn"})'), null);
  assert.equal(run('autoChoice({id:"unknown",rt:"unknown"})'), null);
});

test("Auto executes using the designated engine without synced metadata", async () => {
  const start = html.indexOf("async function runRemote(");
  const end = html.indexOf("async function runPy(", start);
  const requests = [];
  const context = vm.createContext({
    providerUrl: provider => provider, line() {}, showResult: () => true,
    postExecute: async (url, token, language, source, input, signal, provider) => {
      requests.push({ url, provider, language: language.rt });
      return { compile: { code: 0 }, run: { code: 0 } };
    },
    reachError: error => error, AbortController, setTimeout, clearTimeout
  });
  vm.runInContext(html.slice(start, end), context);
  assert.equal(await vm.runInContext('runRemote({rt:"c"},"","", "wandbox",{},true)', context), true);
  assert.equal(await vm.runInContext('runRemote({rt:"powershell"},"","", "tio",{},true)', context), true);
  assert.deepEqual(requests, [{ url: "wandbox", provider: "wandbox", language: "c" },
    { url: "tio", provider: "tio", language: "powershell" }]);
});

test("TIO's built-in aliases work without catalog sync", async () => {
  const start = html.indexOf("async function postExecute(");
  const end = html.indexOf("const LOCAL_RTS=", start);
  const requests = [];
  const context = vm.createContext({
    fetch: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return { ok: true, text: async () => '{"run":{"code":0}}' };
    },
    getRemoteFilename: () => "main.fs"
  });
  vm.runInContext(html.slice(start, end), context);
  await vm.runInContext('postExecute("url","",{rt:"fsi"},"code","",null,"tio")', context);
  assert.equal(requests[0].language, "tio:f%23");
  assert.equal(requests[0].version, "fs-core");
  await vm.runInContext('postExecute("url","",{rt:"basic"},"code","",null,"tio")', context);
  assert.equal(requests[1].language, "tio:my-basic");
});

test("Auto treats a Wandbox compiler permission error as an engine failure", async () => {
  const start = html.indexOf("async function runRemote(");
  const end = html.indexOf("async function runPy(", start);
  const context = vm.createContext({
    providerUrl: () => "engine", line: () => {}, showResult: () => false,
    postExecute: async () => ({ compile: { code: 1, stderr: "/opt/wandbox/scala/bin/scalac: Permission denied" } }),
    reachError: error => error, AbortController, setTimeout, clearTimeout
  });
  vm.runInContext(html.slice(start, end), context);
  const run = () => vm.runInContext('runRemote({rt:"scala",wandboxVersions:[{id:"scala"}]},"","", "wandbox",{},true)', context);
  await assert.rejects(run(), /compiler could not start/);
  context.postExecute = async () => ({ compile: { code: 1, stderr: "syntax error" } });
  assert.equal(await run(), false);
});

test("Erlang is not sent to Wandbox even when it is explicitly selected", async () => {
  const start = html.indexOf("async function runRemote(");
  const end = html.indexOf("async function runPy(", start);
  const context = vm.createContext({ providerUrl: () => "engine" });
  vm.runInContext(html.slice(start, end), context);
  await assert.rejects(vm.runInContext('runRemote({rt:"erlang",tioOnly:true},"","", "wandbox",{},false)', context),
    /Erlang uses TIO/);
});

test("connection errors distinguish an unavailable runner from provider failures", () => {
  const start = html.indexOf("function reachError(");
  const end = html.indexOf("async function postExecute(", start);
  const context = vm.createContext({ localPage: true, localRunnerBase: "http://127.0.0.1:3002" });
  vm.runInContext(html.slice(start, end), context);
  const reachError = context.reachError;
  assert.match(reachError(new TypeError("Failed to fetch"), "http://127.0.0.1:3002/api/v2/tio/execute").message,
    /runner is not reachable.*start-sprig\.bat.*opened page/i);
  const providerError = new Error("TIO execution failed (HTTP 503).");
  assert.equal(reachError(providerError, "http://127.0.0.1:3002/api/v2/tio/execute"), providerError);
  assert.match(reachError(new TypeError("Failed to fetch"), "https://engine.example/execute").message,
    /Could not reach https:\/\/engine\.example\/execute/);
});

test("TIO runs show version limitations and explain modern Koka syntax failures", async () => {
  const start = html.indexOf("async function runRemote(");
  const end = html.indexOf("async function runPy(", start);
  const messages = [], requests = [];
  const context = vm.createContext({
    providerUrl: () => "tio", line: text => messages.push(text), showResult: result => result.run.code === 0,
    postExecute: async (url, token, language, source, input, signal, provider) => {
      requests.push({ source, provider });
      return { run: { code: 1, stderr: "unexpected identifier pub" } };
    },
    reachError: error => error, AbortController, setTimeout, clearTimeout
  });
  vm.runInContext(html.slice(start, end), context);
  assert.equal(await vm.runInContext('runRemote({rt:"koka",tioKey:"koka",tioVersions:[{id:"koka"}]},"pub fun main() {}","", "tio",{},true)', context), false);
  assert.deepEqual(requests, [{ source: "pub fun main() {}", provider: "tio" }]);
  assert.ok(messages.some(text => /compiler and libraries.*local version/.test(text)));
  assert.ok(messages.some(text => /Koka.*pub fun.*newer Koka/.test(text)));
  messages.length = 0;
  await vm.runInContext('runRemote({rt:"ada",tioKey:"ada",tioVersions:[{id:"ada"}]},"","", "tio",{},true)', context);
  assert.ok(messages.some(text => /compiler and libraries/.test(text)));
  assert.ok(messages.every(text => !/pub fun/.test(text)));
});

test("catalog discovery associates supported implementations with browser and named modes", async () => {
  const start = html.indexOf("async function syncRuntimeOptions(");
  const end = html.indexOf("function syncAllEngines(", start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({
    ORDER: ["browser", "node"],
    store: { set() {} },
    L: { browser: { rt: "@js", local: true, s: "example" }, node: { rt: "node", s: "example" } },
    runtimeListUrl: () => "catalog",
    fetchRuntimeList: async () => [{
      provider: "wandbox", baseLanguage: "node", defaultVersion: "node-1",
      versions: [{ id: "node-1" }]
    }]
  });
  vm.runInContext(html.slice(start, end), context);
  await vm.runInContext('syncRuntimeOptions("wandbox","","")', context);
  assert.equal(context.L.browser.wandboxDefault, "node-1");
  assert.equal(context.L.node.wandboxDefault, "node-1");
});

test("synced catalogs can be restored without contacting an engine", async () => {
  const start = html.indexOf("async function syncRuntimeOptions(");
  const end = html.indexOf("function syncAllEngines(", start);
  const saved = new Map();
  const createContext = fetchRuntimeList => {
    const context = vm.createContext({
      ORDER: ["c"], L: { c: { rt: "c", s: "example" } },
      store: { set: (key, value) => saved.set(key, value) },
      runtimeListUrl: () => "catalog", fetchRuntimeList
    });
    vm.runInContext(html.slice(start, end), context);
    return context;
  };
  const original = createContext(async () => [{
    provider: "wandbox", baseLanguage: "c", defaultVersion: "gcc-1", versions: [{ id: "gcc-1" }]
  }]);
  await vm.runInContext('syncRuntimeOptions("wandbox","","")', original);
  const restored = createContext(() => { throw new Error("Unexpected catalog request"); });
  restored.savedCatalog = saved.get("sprig.catalog.wandbox");
  vm.runInContext('applyRuntimeOptions("wandbox",JSON.parse(savedCatalog))', restored);
  assert.equal(restored.L.c.wandboxDefault, "gcc-1");
});

test("catalog discovery uses compatible TIO implementations for F# Interactive and BASIC", async () => {
  const start = html.indexOf("async function syncRuntimeOptions(");
  const end = html.indexOf("function syncAllEngines(", start);
  const context = vm.createContext({
    ORDER: ["fsharp", "fsi", "basic"],
    store: { set() {} },
    L: {
      fsharp: { rt: "fsharp.net", s: "example" },
      fsi: { rt: "fsi", s: "example" },
      basic: { rt: "basic", s: "example" }
    },
    runtimeListUrl: () => "catalog",
    fetchRuntimeList: async () => [
      { provider: "tio", baseLanguage: "fsharp.net", tioKey: "f#", defaultVersion: "fs-mono",
        versions: [{ id: "fs-mono" }, { id: "fs-core" }] },
      { provider: "tio", baseLanguage: "tio:my-basic", tioKey: "my-basic", defaultVersion: "my-basic",
        versions: [{ id: "my-basic" }] }
    ]
  });
  vm.runInContext(html.slice(start, end), context);
  await vm.runInContext('syncRuntimeOptions("tio","","")', context);
  assert.equal(context.L.fsi.tioDefault, "fs-core");
  assert.deepEqual(Array.from(context.L.fsi.tioVersions, version => version.id), ["fs-core"]);
  assert.equal(context.L.basic.tioKey, "my-basic");
});

test("C# .NET only receives .NET versions from the Wandbox C# catalog", async () => {
  const start = html.indexOf("async function syncRuntimeOptions(");
  const end = html.indexOf("function syncAllEngines(", start);
  const context = vm.createContext({
    ORDER: ["mono", "dotnet"],
    store: { set() {} },
    L: { mono: { rt: "csharp", s: "example" }, dotnet: { rt: "csharp.net", s: "example" } },
    runtimeListUrl: () => "catalog",
    fetchRuntimeList: async () => [{
      provider: "wandbox", baseLanguage: "csharp", defaultVersion: "mono",
      versions: [{ id: "mono" }, { id: "dotnetcore-8.0.402" }, { id: "dotnetcore-6.0.425" }]
    }]
  });
  vm.runInContext(html.slice(start, end), context);
  await vm.runInContext('syncRuntimeOptions("wandbox","","")', context);
  assert.deepEqual(Array.from(context.L.dotnet.wandboxVersions, version => version.id), [
    "dotnetcore-8.0.402", "dotnetcore-6.0.425"
  ]);
  assert.equal(context.L.dotnet.wandboxDefault, "dotnetcore-6.0.425");
});

test("successful compiler messages are not treated as failed Auto runs", () => {
  const start = html.indexOf("function showResult(");
  const end = html.indexOf("function reachError(", start);
  const output = [];
  const context = vm.createContext({
    write: (text, type) => output.push({ text, type }),
    line: (text, type) => output.push({ text, type })
  });

  vm.runInContext(html.slice(start, end), context);
  const success = vm.runInContext('showResult({compile:{code:0,stderr:"build output"},run:{code:0,stdout:"hello"}})', context);
  assert.equal(success, true);
  assert.equal(output[0].type, "i");
});

test("compiler stdout errors are shown, and failures without output are explained", () => {
  const start = html.indexOf("function showResult(");
  const end = html.indexOf("function reachError(", start);
  const output = [];
  const context = vm.createContext({ write: (text, type) => output.push({ text, type }), line: (text, type) => output.push({ text, type }) });
  vm.runInContext(html.slice(start, end), context);
  assert.equal(vm.runInContext('showResult({compile:{code:1,stdout:"Module name mismatch",stderr:""},run:null})', context), false);
  assert.match(output[0].text, /Module name mismatch/);
  assert.equal(output[0].type, "e");
  output.length = 0;
  assert.equal(vm.runInContext('showResult({compile:{code:1,stdout:"",stderr:""},run:null})', context), false);
  assert.match(output[0].text, /no diagnostics/);
});

test("local availability checks executables, supporting tools, and required files", async () => {
  const start = runner.indexOf("async function localCommand(");
  const end = runner.indexOf("async function promptDownload(", start);
  assert.ok(start >= 0 && end > start);
  const present = new Set(["java", "node"]);
  const context = vm.createContext({
    commands: { java: ["java"], effekt: ["java", "C:\\missing\\effekt.jar"] },
    process: { platform: "win32" },
    commandAvailable: async command => present.has(command),
    path: path.win32,
    fs: { existsSync: () => false }
  });
  vm.runInContext(runner.slice(start, end), context);
  assert.equal(await vm.runInContext('localRuntimeAvailable("java")', context), false);
  present.add("javac");
  assert.equal(await vm.runInContext('localRuntimeAvailable("java")', context), true);
  assert.equal(await vm.runInContext('localRuntimeAvailable("effekt")', context), false);
});

test("Windows Scala discovery uses a native executable instead of a batch launcher", async () => {
  const start = runner.indexOf("async function localCommand(");
  const end = runner.indexOf("async function promptDownload(", start);
  const present = new Set(["scala-cli.exe"]);
  const context = vm.createContext({
    commands: { scala: ["scala"] }, process: { platform: "win32" },
    commandAvailable: async command => present.has(command),
    path: path.win32, fs: { existsSync: () => true }
  });
  vm.runInContext(runner.slice(start, end), context);
  assert.deepEqual(Array.from(await vm.runInContext('localCommand("scala")', context)), ["scala-cli.exe", "run", "--server=false"]);
  assert.equal(await vm.runInContext('localRuntimeAvailable("scala")', context), true);
  present.clear();
  assert.equal(await vm.runInContext('localRuntimeAvailable("scala")', context), false);
});

test("Auto local execution refuses missing runtimes without prompting for installation", async () => {
  const start = runner.indexOf("async function execute(payload)");
  const end = runner.indexOf("const server = ", start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({
    localCommand: async () => ["missing-runtime"],
    commandAvailable: async () => false,
    path,
    fs: { existsSync: () => false },
    promptDownload: () => { throw new Error("Unexpected installation prompt"); }
  });
  vm.runInContext(runner.slice(start, end), context);
  await assert.rejects(vm.runInContext('execute({language:"example",allowInstall:false})', context),
    /missing-runtime.*not installed/);
});
