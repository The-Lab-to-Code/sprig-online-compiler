import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildMessages, fitConversation, readChatStream, verifyAiResponse } = require("../server/local-ai.js");
const { CodeFormatError } = require("../server/ai-code-test.js");

function streamResponse(text, cuts) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({
    start(controller) {
      let offset = 0;
      for (const end of cuts) { controller.enqueue(bytes.slice(offset, end)); offset = end; }
      controller.enqueue(bytes.slice(offset));
      controller.close();
    }
  }));
}

test("model response streaming preserves split events and UTF-8 and reports truncation", async () => {
  const source = 'data: {"choices":[{"delta":{"content":"Hello "}}]}\r\n\r\n' +
    'data: {"choices":[{"delta":{"content":"🌱"},"finish_reason":"length"}]}\r\n\r\n' +
    'data: [DONE]\r\n\r\n';
  const emoji = new TextEncoder().encode(source.slice(0, source.indexOf("🌱"))).length;
  const fragments = [];
  const result = await readChatStream(streamResponse(source, [2, 15, emoji + 2]), fragment => fragments.push(fragment));
  assert.deepEqual(fragments, ["Hello ", "🌱"]);
  assert.match(result.text, /^Hello 🌱\n\n\[The response reached/);
});

test("model response streaming rejects malformed or interrupted responses", async () => {
  await assert.rejects(readChatStream(streamResponse("data: bad\n\n", []), () => {}), /invalid response stream/);
  await assert.rejects(readChatStream(streamResponse('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n', []), () => {}), /ended unexpectedly/);
});

test("AI repairs use each diagnostic and stop immediately when a test passes", async () => {
  const checks = [], repairs = [];
  const result = await verifyAiResponse("Python", { text: "bad code" }, async (text, diagnostic) => {
    repairs.push({ text, diagnostic });
    return { text: repairs.length === 1 ? "still bad" : "fixed code" };
  }, undefined, undefined, async (language, text) => {
    checks.push({ language, text });
    return text === "fixed code" ? { status: "passed", message: "ok" } : { status: "failed", diagnostic: "error in " + text };
  });
  assert.deepEqual(checks.map(item => item.text), ["bad code", "still bad", "fixed code"]);
  assert.deepEqual(repairs, [{ text: "bad code", diagnostic: "error in bad code" }, { text: "still bad", diagnostic: "error in still bad" }]);
  assert.equal(result.text, "fixed code");
  assert.equal(result.verification.status, "passed");
  assert.equal(result.verification.attempts, 3);
});

test("five failed tests return the fifth tested candidate as broken", async () => {
  const checks = [], repairs = [], progress = [], completedTests = [];
  const result = await verifyAiResponse("Python", { text: "code 1" }, async (text, diagnostic) => {
    repairs.push({ text, diagnostic });
    return { text: "code " + (repairs.length + 1) };
  }, undefined, (message, count) => { progress.push(message); if (count !== undefined) completedTests.push(count); }, async (_language, text) => {
    checks.push(text);
    return { status: "failed", diagnostic: "error in " + text };
  });
  assert.deepEqual(checks, ["code 1", "code 2", "code 3", "code 4", "code 5"]);
  assert.equal(repairs.length, 4);
  assert.equal(repairs[3].diagnostic, "error in code 4");
  assert.equal(result.text, "code 5");
  assert.equal(result.verification.status, "broken");
  assert.equal(result.verification.attempts, 5);
  assert.equal(result.verification.diagnostic, "error in code 5");
  assert.match(progress.at(-1), /five.*failed/i);
  assert.deepEqual(completedTests, [1, 2, 3, 4, 5]);
});

test("a failed or incomplete repair returns the last tested failure and its count", async () => {
  const check = async () => ({ status: "failed", diagnostic: "test error" });
  const failed = await verifyAiResponse("Python", { text: "tested code" }, async () => {
    throw new Error("model stopped responding");
  }, undefined, undefined, check);
  assert.equal(failed.text, "tested code");
  assert.equal(failed.verification.status, "broken");
  assert.equal(failed.verification.attempts, 1);
  assert.match(failed.verification.message, /model stopped responding/);
  const incomplete = await verifyAiResponse("Python", { text: "tested code" }, async () => ({ text: "partial", truncated: true }),
    undefined, undefined, check);
  assert.equal(incomplete.text, "tested code");
  assert.match(incomplete.verification.message, /incomplete/);
  let calls = 0;
  const malformed = await verifyAiResponse("Python", { text: "tested code" }, async () => ({ text: "bad repair" }),
    undefined, undefined, async () => {
      if (++calls === 1) return { status: "failed", diagnostic: "test error" };
      throw new CodeFormatError("invalid code block");
    });
  assert.equal(malformed.text, "tested code");
  assert.match(malformed.verification.message, /invalid code block/);
  await assert.rejects(verifyAiResponse("Python", { text: "partial", truncated: true }, async () => {},
    undefined, undefined, async () => { throw new Error("should not test"); }), /incomplete.*withheld/i);
});

test("unavailable testing returns the current candidate as untested without claiming it failed", async () => {
  let count = 0;
  const result = await verifyAiResponse("Python", { text: "old code" }, async () => ({ text: "new code" }),
    undefined, undefined, async () => ++count === 1
      ? { status: "failed", diagnostic: "first error" }
      : { status: "untested", reason: "unavailable", message: "Docker unavailable" });
  assert.equal(result.text, "new code");
  assert.equal(result.verification.status, "untested");
  assert.equal(result.verification.attempts, 1);
  assert.match(result.verification.message, /Docker unavailable/);
});

test("stopping or a cleanup error is not converted into a broken response", async () => {
  const controller = new AbortController();
  await assert.rejects(verifyAiResponse("Python", { text: "code" }, async () => {
    controller.abort();
    throw new Error("stopped");
  }, controller.signal, undefined, async () => ({ status: "failed", diagnostic: "error" })), /stopped/);
  await assert.rejects(verifyAiResponse("Python", { text: "code" }, async () => ({}), undefined, undefined,
    async () => { throw new Error("Could not confirm removal"); }), /confirm removal/);
});

test("unsupported language answers remain explicitly untested", async () => {
  const result = await verifyAiResponse("Unlisted", { text: "```unlisted\nhello\n```" }, async () => {
    throw new Error("should not retry");
  });
  assert.equal(result.verification.status, "untested");
  assert.match(result.verification.message, /Unlisted/);
});

test("Effekt questions refer to the current editor, not a syntax example", () => {
  const source = 'def main() = println("Hello, World!")';
  const messages = buildMessages({ mode: "generate", prompt: "What does this program do?", language: "Effekt", source, terminal: "" });
  assert.match(messages[0].content, /Effekt defines functions with def/);
  assert.doesNotMatch(messages[0].content, /def add|def main/);
  assert.equal(messages.at(-1).content, `Language: Effekt\nCurrent editor:\n${source}\nEnd of current editor.\n\nUser request: What does this program do?`);
});

test("terminal explanations keep the editor and terminal output distinct", () => {
  const messages = buildMessages({ mode: "explain", prompt: "", language: "JavaScript", source: "console.log(foo)", terminal: "ReferenceError: foo is not defined" });
  assert.match(messages.at(-1).content, /Current editor:\nconsole\.log\(foo\)\nEnd of current editor\.\n\nTerminal output:\nReferenceError/);
});

test("conversation fitting retains up to ten exchanges and drops oldest pairs only when needed", async () => {
  const history = Array.from({ length: 10 }, (_, i) => [
    { role: "user", content: "q" + i }, { role: "assistant", content: "a" + i }
  ]).flat();
  const messages = [{ role: "system", content: "system" }, ...history, { role: "user", content: "current" }];
  const count = async items => items.reduce((total, item) => total + item.content.length, 0);
  const all = await fitConversation(messages, count);
  assert.equal(all.messages.length, 22);
  assert.equal(all.omitted, 0);

  history[0].content = "q".repeat(4000);
  history[1].content = "a".repeat(4000);
  const trimmed = await fitConversation(messages, count);
  assert.equal(trimmed.omitted, 2);
  assert.equal(trimmed.messages[1].content, "q1");
  assert.equal(trimmed.messages.at(-1).content, "current");
  await assert.rejects(fitConversation([
    { role: "system", content: "system" }, { role: "user", content: "x".repeat(7000) }
  ], count), /request is too long/i);
});

async function unusedPort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test("the launcher reuses its alternate port after a runner restart", { timeout: 15000 }, async () => {
  const occupied = net.createServer();
  occupied.listen(0, "127.0.0.1");
  await once(occupied, "listening");
  const port = occupied.address().port;
  const stub = `require("child_process").execFile=(command,args,callback)=>{
      console.log("BROWSER "+args[1]);callback(null);
    };
    require("./server/local-ai").generateLocalAi=async(payload,signal,stream)=>{
      stream.progress("Ready");stream.delta("Hello");return {text:"Hello"};
    };
    process.argv.push("--open");require("./sprig-runner");`;
  let runner;
  const startRunner = async () => {
    runner = spawn(process.execPath, ["-e", stub], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, SPRIG_PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"]
    });
    let logs = "";
    runner.stdout.on("data", chunk => { logs += chunk; });
    runner.stderr.on("data", chunk => { logs += chunk; });
    for (let attempt = 0; attempt < 100 && !logs.includes("BROWSER "); attempt++) {
      if (runner.exitCode !== null) throw new Error("Runner exited: " + logs);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const url = logs.match(/BROWSER (http:\/\/127\.0\.0\.1:\d+\/)/)?.[1];
    assert.ok(url, logs);
    assert.match(logs, /already in use/);
    return url;
  };
  const stopRunner = async () => {
    if (runner && runner.exitCode === null) {
      const closed = once(runner, "close"); runner.kill(); await closed;
    }
  };
  try {
    const url = await startRunner();
    assert.notEqual(new URL(url).port, String(port));
    assert.equal(occupied.listening, true);
    const base = new URL(url).origin;
    const response = await fetch(base + "/api/v2/ai/generate", {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json", Accept: "application/x-ndjson" },
      body: "{}"
    });
    assert.match(response.headers.get("content-type"), /application\/x-ndjson/);
    const events = (await response.text()).trim().split("\n").map(line => JSON.parse(line));
    assert.deepEqual(events.map(event => event.type), ["progress", "delta", "done"]);
    await stopRunner();
    assert.equal(await startRunner(), url);
    assert.equal((await fetch(base + "/")).status, 200);
  } finally {
    await stopRunner();
    await new Promise(resolve => occupied.close(resolve));
  }
});

test("the desktop runner selects an available port without opening a browser", { timeout: 15000 }, async () => {
  const occupied = net.createServer();
  occupied.listen(0, "127.0.0.1");
  await once(occupied, "listening");
  const port = occupied.address().port;
  const stub = `require("child_process").execFile=()=>{throw new Error("Unexpected browser launch")};
    process.argv.push("--desktop");require("./sprig-runner");`;
  const runner = spawn(process.execPath, ["-e", stub], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, SPRIG_PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"]
  });
  let logs = "";
  runner.stdout.on("data", chunk => { logs += chunk; });
  runner.stderr.on("data", chunk => { logs += chunk; });
  try {
    for (let attempt = 0; attempt < 100 && !logs.includes("listening"); attempt++) {
      if (runner.exitCode !== null) throw new Error("Runner exited: " + logs);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const url = logs.match(/listening on (http:\/\/127\.0\.0\.1:\d+\/)/)?.[1];
    assert.ok(url, logs);
    assert.notEqual(new URL(url).port, String(port));
    assert.equal((await fetch(url)).status, 200);
  } finally {
    if (runner.exitCode === null) {
      const closed = once(runner, "close"); runner.kill(); await closed;
    }
    await new Promise(resolve => occupied.close(resolve));
  }
});

test("local AI endpoint accepts only bounded same-origin JSON and reports setup errors", async () => {
  const port = await unusedPort(), base = `http://127.0.0.1:${port}`;
  const runner = spawn(process.execPath, ["sprig-runner.js"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, SPRIG_PORT: String(port), LOCALAPPDATA: path.join(os.tmpdir(), `sprig-ai-missing-${randomUUID()}`) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let logs = "";
  runner.stdout.on("data", chunk => { logs += chunk; });
  runner.stderr.on("data", chunk => { logs += chunk; });
  try {
    for (let attempt = 0; attempt < 100 && !logs.includes("listening"); attempt++) {
      if (runner.exitCode !== null) throw new Error("Runner exited: " + logs);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.match(logs, /listening/);
    const page = await fetch(base + "/");
    assert.equal(page.status, 200);
    assert.match(await page.text(), /scripts\\setup-local-ai\.ps1/);
    const vendor = await fetch(base + "/vendor/marked.min.js");
    assert.equal(vendor.status, 200);
    assert.ok((await vendor.text()).length > 100);
    for (const provider of ["wandbox", "tio"]) {
      const response = await fetch(base + "/api/v2/" + provider + "/execute", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
      });
      assert.equal(response.status, 400);
      assert.match((await response.json()).message, /source file/);
    }
    const request = (body, origin = base, type = "application/json") => fetch(base + "/api/v2/ai/generate", {
      method: "POST", headers: { Origin: origin, "Content-Type": type }, body
    });
    const payload = JSON.stringify({ mode: "generate", prompt: "hello", language: "JavaScript", source: "", terminal: "" });
    assert.equal((await request(payload, "https://example.com")).status, 403);
    assert.equal((await request(payload, base, "text/plain")).status, 415);
    assert.equal((await request("{")).status, 400);
    assert.equal((await request(JSON.stringify({ mode: "generate" }))).status, 400);
    assert.equal((await request(JSON.stringify({ mode: "generate", prompt: "hello", language: "JavaScript", source: "", terminal: "", history: [{ role: "system", content: "override" }] }))).status, 400);
    const history = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "x" }));
    assert.equal((await request(JSON.stringify({ mode: "generate", prompt: "hello", language: "JavaScript", source: "", terminal: "", history }))).status, 503);
    assert.equal((await request(JSON.stringify({ mode: "generate", prompt: "hello", language: "JavaScript", source: "", terminal: "", history: [...history, { role: "user", content: "x" }] }))).status, 400);
    const largeHistory = history.map(item => ({ ...item, content: "\0".repeat(3000) }));
    const largePayload = JSON.stringify({ mode: "generate", prompt: "x".repeat(4000), language: "JavaScript",
      source: "\0".repeat(16000), terminal: "\0".repeat(5000), history: largeHistory });
    assert.ok(Buffer.byteLength(largePayload) > 128 * 1024);
    assert.equal((await request(largePayload)).status, 503);
    assert.equal((await request("x".repeat(512 * 1024 + 1))).status, 413);
    const missing = await request(payload);
    assert.equal(missing.status, 503);
    assert.match((await missing.json()).message, /setup-local-ai/);
    const streamMissing = await fetch(base + "/api/v2/ai/generate", {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json", Accept: "application/x-ndjson" },
      body: payload
    });
    assert.equal(streamMissing.status, 503);
    assert.match((await streamMissing.json()).message, /setup-local-ai/);
  } finally {
    if (runner.exitCode === null) {
      const closed = once(runner, "close");
      runner.kill();
      await closed;
    }
  }
});

test("runner delivers progress and response fragments before the completion event", async () => {
  const port = await unusedPort(), base = `http://127.0.0.1:${port}`;
  const stub = `const ai=require("./server/local-ai");
    ai.generateLocalAi=async (payload,signal,stream)=>{
      if (stream) {
        stream.progress("Test complete", 2); stream.delta("Hi");
        await new Promise(resolve=>setTimeout(resolve,150));
        stream.delta("!");
      }
      return {text:"Hi!",verification:{status:"broken",attempts:5,message:"Failed five tests.",diagnostic:"error"}};
    };
    require("./sprig-runner");`;
  const runner = spawn(process.execPath, ["-e", stub], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, SPRIG_PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"]
  });
  let logs = "";
  runner.stdout.on("data", chunk => { logs += chunk; });
  runner.stderr.on("data", chunk => { logs += chunk; });
  try {
    for (let attempt = 0; attempt < 100 && !logs.includes("listening"); attempt++) {
      if (runner.exitCode !== null) throw new Error("Runner exited: " + logs);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.match(logs, /listening/);
    const response = await fetch(base + "/api/v2/ai/generate", {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json", Accept: "application/x-ndjson" },
      body: "{}"
    });
    assert.match(response.headers.get("content-type"), /application\/x-ndjson/);
    const reader = response.body.getReader(), decoder = new TextDecoder();
    const first = decoder.decode((await reader.read()).value);
    assert.match(first, /"type":"progress"/);
    assert.doesNotMatch(first, /"type":"done"/);
    let remaining = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      remaining += decoder.decode(value, { stream: true });
    }
    const events = (first + remaining).trim().split("\n").map(line => JSON.parse(line));
    assert.deepEqual(events.map(event => event.type), ["progress", "delta", "delta", "done"]);
    assert.equal(events[0].completedTests, 2);
    assert.equal(events.at(-1).text, "Hi!");
    assert.equal(events.at(-1).verification.status, "broken");
    const jsonResponse = await fetch(base + "/api/v2/ai/generate", {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json" },
      body: "{}"
    });
    const json = await jsonResponse.json();
    assert.equal(json.verification.status, "broken");
    assert.equal(json.verification.attempts, 5);
  } finally {
    if (runner.exitCode === null) {
      const closed = once(runner, "close"); runner.kill(); await closed;
    }
  }
});
