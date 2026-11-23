import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const start = html.indexOf("async function runLocalStream(");
const end = html.indexOf("async function runRemote(", start);
assert.ok(start >= 0 && end > start);
const source = html.slice(start, end);

function localRun(response) {
  const output = [];
  const input = { placeholder: "", focus() {} };
  const context = vm.createContext({
    fetch: async () => response, AbortController, TextDecoder, Uint8Array, setTimeout, clearTimeout,
    line: (text, type) => output.push({ text, type }), write: (text, type) => output.push({ text, type }),
    $: () => input, getRemoteFilename: () => "main.js",
    reachError: error => error, console, job: null, liveStdin: null, runCancelled: false
  });
  vm.runInContext(source, context);
  return { context, output, input, run: () => vm.runInContext('runLocalStream("http://runner/execute",{rt:"node"},"","")', context) };
}

test("a local run finishes on the exit event even if the response remains open", { timeout: 5000 }, async () => {
  const encoder = new TextEncoder();
  let controller, cancelled = false;
  const response = new Response(new ReadableStream({
    start(value) { controller = value; },
    cancel() { cancelled = true; }
  }));
  const { context, output, input, run } = localRun(response);
  const pending = run();
  controller.enqueue(encoder.encode('{"stdout":"hello\\n"}\n'));
  let finished = false;
  pending.then(() => { finished = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished, false);
  controller.enqueue(encoder.encode('{"exit":0}\n'));
  let timeout;
  try {
    const result = await Promise.race([pending, new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("Run stayed active after exit")), 500);
    })]);
    assert.equal(result, true);
    assert.equal(cancelled, true);
    assert.ok(output.some(item => item.text === "hello\n"));
    assert.equal(input.placeholder, "Type stdin and press Enter");
  } finally {
    clearTimeout(timeout);
    if (!finished) { context.job.kill(); controller.close(); await pending.catch(() => {}); }
  }
});

test("a local stream ending without an exit event reports an error", async () => {
  const response = new Response(new ReadableStream({ start(controller) { controller.close(); } }));
  await assert.rejects(localRun(response).run(), /without an exit status/i);
});

test("a nonzero exit finishes the run and reports the failure", async () => {
  const encoder = new TextEncoder();
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(encoder.encode('{"exit":2}\n')); }
  }));
  const { run, output } = localRun(response);
  assert.equal(await run(), false);
  assert.ok(output.some(item => item.text.includes("exit code 2")));
});
