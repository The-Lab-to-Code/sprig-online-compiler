import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";

const require = createRequire(import.meta.url);
const { testCode } = require("../server/ai-code-test.js");
const host = "npipe:////./pipe/dockerDesktopLinuxEngine";

function dockerAvailable(images = ["node:24-alpine", "python:3.14-alpine"]) {
  if (process.platform !== "win32") return false;
  try {
    for (const image of images) {
      execFileSync("docker", ["--host", host, "image", "inspect", image], { stdio: "ignore", timeout: 5000 });
    }
    return true;
  } catch {
    return false;
  }
}

test("unavailable languages are explicitly untested and ambiguous supported code is rejected", async () => {
  assert.equal((await testCode("Unlisted", "```unlisted\nhello\n```")).status, "untested");
  assert.equal((await testCode("Python", "An explanation.")).status, "untested");
  await assert.rejects(testCode("Python", "```python\nprint(1)"), /incomplete/);
  await assert.rejects(testCode("Python", "```python\nprint(1)\n```\n```python\nprint(2)"), /one runnable/);
  await assert.rejects(testCode("Python", "```js\nalert(1)\n```"), /one runnable/);
  await assert.rejects(testCode("Python", "```python\nprint(1)\n```\n```python\nprint(2)\n```"), /one runnable/);
});

function loadWithSpawn(spawn) {
  const childProcess = require("node:child_process"), originalSpawn = childProcess.spawn;
  const modulePath = require.resolve("../server/ai-code-test.js"), cached = require.cache[modulePath];
  try {
    childProcess.spawn = spawn;
    delete require.cache[modulePath];
    return require(modulePath).testCode;
  } finally {
    childProcess.spawn = originalSpawn;
    require.cache[modulePath] = cached;
  }
}

test("an unavailable Docker image is reported as untested without starting a container", { skip: process.platform !== "win32" }, async () => {
  const calls = [];
  const isolatedTest = loadWithSpawn((_executable, args) => {
    calls.push(args[2]);
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.stdin = new Writable({ write(_chunk, _encoding, done) { done(); } });
    process.nextTick(() => { child.stderr.write("image not found"); child.emit("close", 1); });
    return child;
  });
  const result = await isolatedTest("Python", "```python\nprint(1)\n```");
  assert.equal(result.status, "untested");
  assert.equal(result.reason, "unavailable");
  assert.match(result.message, /setup-ai-testing/);
  assert.deepEqual(calls, ["image"]);
});

test("TypeScript type errors and PowerShell command errors fail the test", {
  skip: !dockerAvailable(["sprig-ai-typescript:1", "mcr.microsoft.com/powershell:7.5-ubuntu-24.04"]), timeout: 60000
}, async () => {
  assert.equal((await testCode("TypeScript", "```ts\nconst n: number = 1; console.log(n);\n```")).status, "passed");
  assert.equal((await testCode("TypeScript", "```ts\nconst n: number = 'wrong';\n```")).status, "failed");
  assert.equal((await testCode("PowerShell", "```powershell\nWrite-Output 'ok'\n```")).status, "passed");
  assert.equal((await testCode("PowerShell", "```powershell\nparam([string]$name = 'ok')\nWrite-Output $name\n```")).status, "passed");
  assert.equal((await testCode("PowerShell", "```powershell\nGet-Item /does-not-exist\n```")).status, "failed");
});

test("modern Koka syntax runs in the isolated compiler", {
  skip: !dockerAvailable(["sprig-ai-koka:3.2.9"]), timeout: 90000
}, async () => {
  assert.equal((await testCode("Koka", '```koka\npub fun main() { println("hello") }\n```')).status, "passed");
});

test("Docker tests pass or fail real programs without network or host access", { skip: !dockerAvailable(), timeout: 60000 }, async () => {
  const python = [
    "import os, socket",
    "assert os.geteuid() != 0",
    "try:",
    "    socket.create_connection(('1.1.1.1', 53), timeout=1)",
    "    raise AssertionError('network was available')",
    "except OSError:",
    "    pass",
    "try:",
    "    open('/outside-test', 'w')",
    "    raise AssertionError('root filesystem was writable')",
    "except OSError:",
    "    pass",
    "print('ok')"
  ].join("\n");
  assert.equal((await testCode("Python", "```python\n" + python + "\n```")).status, "passed");
  assert.equal((await testCode("JavaScript", "```js\nconsole.log('ok')\n```")).status, "passed");
  const failed = await testCode("Python", "```python\nraise ValueError('test failure')\n```");
  assert.equal(failed.status, "failed");
  assert.match(failed.diagnostic, /test failure/);
});

test("a cancelled container test stops and cleans up", { skip: !dockerAvailable(), timeout: 30000 }, async () => {
  const controller = new AbortController();
  const promise = testCode("Python", "```python\nwhile True: pass\n```", controller.signal);
  setTimeout(() => controller.abort(), 1500);
  await assert.rejects(promise, /stopped/);
});

test("a program timeout is a failed test with a usable diagnostic", { skip: !dockerAvailable(), timeout: 35000 }, async () => {
  const result = await testCode("Python", "```python\nwhile True: pass\n```");
  assert.equal(result.status, "failed");
  assert.match(result.diagnostic, /timed out/);
});

test("cancellation during container creation waits before cleaning up", { skip: process.platform !== "win32" }, async () => {
  const calls = [];
  let started;
  const creating = new Promise(resolve => { started = resolve; });
  const isolatedTest = loadWithSpawn((_executable, args) => {
    const stage = args[2], child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.stdin = new Writable({ write(_chunk, _encoding, done) { done(); } });
    child.kill = () => { calls.push("killed"); child.emit("close", null); };
    calls.push(stage);
    if (stage === "create") {
      started();
      setTimeout(() => { calls.push("created"); child.emit("close", 0); }, 40);
    } else process.nextTick(() => child.emit("close", 0));
    return child;
  });
  const controller = new AbortController();
  const promise = isolatedTest("Python", "```python\nprint(1)\n```", controller.signal);
  await creating;
  controller.abort();
  await assert.rejects(promise, /stopped/);
  assert.deepEqual(calls, ["image", "create", "created", "rm"]);
});
