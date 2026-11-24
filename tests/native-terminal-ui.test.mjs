import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const start = html.indexOf("async function runNativeTerminal(");
const end = html.indexOf("async function runPy(", start);
assert.ok(start >= 0 && end > start);

test("the terminal mode sends browser JavaScript to the local Node runtime", async () => {
  const requests = [], messages = [];
  const context = vm.createContext({
    window: {}, localPage: true, location: { protocol: "http:" }, localRunnerBase: "http://127.0.0.1:3001",
    runnerRuntime: language => language.rt === "@js" ? "node" : language.rt,
    line: text => messages.push(text), job: null,
    fetch: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ ok: true }) };
    }
  });
  vm.runInContext(html.slice(start, end), context);
  const result = await vm.runInContext('runRemote({rt:"@js",tioOnly:true},"console.log(1)","", "terminal",{},false)', context);
  assert.equal(result, "external");
  assert.deepEqual(requests, [{
    url: "http://127.0.0.1:3001/api/v2/native-terminal",
    body: { language: "node", source: "console.log(1)" }
  }]);
  assert.ok(messages.some(text => /separate terminal/.test(text)));
  assert.equal(context.job.external, true);
});

test("terminal launch errors are shown instead of claiming the program ran", async () => {
  const context = vm.createContext({
    window: {}, localPage: true, location: { protocol: "http:" }, localRunnerBase: "http://127.0.0.1:3001",
    runnerRuntime: language => language.rt, line() {}, job: null,
    fetch: async () => ({ ok: false, json: async () => ({ message: "Runtime isn't installed." }) })
  });
  vm.runInContext(html.slice(start, end), context);
  await assert.rejects(vm.runInContext('runNativeTerminal({rt:"node"},"")', context), /isn't installed/);
});

test("terminal mode explains disconnected and outdated local runners", async () => {
  const context = vm.createContext({
    window: {}, localPage: true, location: { protocol: "http:" }, localRunnerBase: "http://127.0.0.1:3001",
    runnerRuntime: language => language.rt, line() {}, job: null,
    reachError: () => new Error("The local runner is not reachable."),
    fetch: async () => { throw new TypeError("fetch failed"); }
  });
  vm.runInContext(html.slice(start, end), context);
  await assert.rejects(vm.runInContext('runNativeTerminal({rt:"node"},"")', context), /not reachable/);
  context.fetch = async () => ({ status: 404 });
  await assert.rejects(vm.runInContext('runNativeTerminal({rt:"node"},"")', context), /Restart Sprig/);
});
