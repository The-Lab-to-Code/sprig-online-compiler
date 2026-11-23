import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { execute, listRuntimes, TioError } from "../functions/_lib/tio.mjs";

const functionFile = new URL("../functions/api/v2/tio/[[path]].js", import.meta.url);
const functionSource = await readFile(functionFile, "utf8");
const sharedModule = new URL("../functions/_lib/tio.mjs", import.meta.url).href;
const pageFunctionSource = functionSource.replace(
  '"../../../_lib/tio.mjs"',
  JSON.stringify(sharedModule)
);
const { onRequest } = await import(`data:text/javascript;base64,${Buffer.from(pageFunctionSource).toString("base64")}`);

const languageCatalog = {
  python2: { name: "Python 2", categories: ["practical"], tests: { helloWorld: {
    request: [{ command: "F", payload: { ".code.tio": 'print "Hello, World!"' } }]
  } } },
  python3: { name: "Python 3", categories: ["practical"], tests: { helloWorld: {
    request: [
      { command: "V", payload: { args: [] } },
      { command: "F", payload: { ".code.tio": 'print("Hello, World!")' } }
    ]
  } } },
  "python3-pypy": { name: "Python 3 (PyPy)", categories: ["practical"] },
  "coq-8": { name: "Coq 8", categories: ["practical"] },
  javascript: { name: "JavaScript", categories: ["practical"] },
  nodejs: { name: "Node.js", categories: ["practical"] },
  powershell: { name: "PowerShell", categories: ["practical"] },
  "powershell-core": { name: "PowerShell Core", categories: ["practical"] },
  perl: { name: "Perl", categories: ["practical"] },
  perl6: { name: "Perl 6", categories: ["practical"] },
  befunge: { name: "Befunge-93", categories: ["recreational"] },
  jelly: { name: "Jelly", categories: ["recreational"] },
  lolcode: { name: "LOLCODE", categories: ["recreational"] },
  other: { name: "Other", categories: ["recreational"] },
  "experimental-only": { name: "Experimental Only", categories: ["experimental"] }
};

async function transform(compression, bytes) {
  const stream = new compression("deflate-raw");
  const writer = stream.writable.getWriter();
  await writer.write(bytes);
  await writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

function fakeFetchFor(resultText) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(String(url));
    calls.push({ url: parsed.href, init });
    if (parsed.pathname === "/") {
      return new Response('<script src="/static/tio-frontend.js"></script>');
    }
    if (parsed.pathname === "/static/tio-frontend.js") {
      return new Response('var runURL = "/run"; languageFileRequest.open("GET", "/languages.json"');
    }
    if (parsed.pathname === "/languages.json") {
      return new Response(JSON.stringify(languageCatalog), {
        headers: { "Content-Type": "application/json" }
      });
    }
    if (parsed.pathname.startsWith("/run/")) {
      const requestState = new TextDecoder().decode(
        await transform(DecompressionStream, new Uint8Array(init.body))
      );
      calls[calls.length - 1].state = requestState;
      const compressed = await transform(CompressionStream, new TextEncoder().encode(resultText));
      const bytes = new Uint8Array(18 + compressed.length);
      bytes.set([31, 139, 8, 0, 0, 0, 0, 0, 0, 3]);
      bytes.set(compressed, 10);
      return new Response(bytes);
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  return { calls, fetchImpl };
}

function encodeResult(stdout, debug, warnings = "") {
  const separator = "0123456789abcdef";
  return `${separator}${stdout}${separator}${debug}${separator}${warnings}`;
}

test("runtime discovery groups TIO implementations into language families", async () => {
  const runtimes = await listRuntimes(async url => {
    const path = new URL(String(url)).pathname;
    if (path === "/") return new Response('<script src="/static/tio-frontend.js"></script>');
    if (path === "/static/tio-frontend.js") {
      return new Response('var runURL = "/run"; languageFileRequest.open("GET", "/languages.json"');
    }
    return new Response(JSON.stringify(languageCatalog));
  });
  const python = runtimes.find(runtime => runtime.tioKey === "python");
  assert.equal(python.baseLanguage, "@py");
  assert.equal(python.defaultVersion, "python3");
  assert.equal(python.starter, 'print("Hello, World!")');
  assert.deepEqual(python.versions.map(version => version.id).sort(), [
    "python2", "python3", "python3-pypy"
  ]);
  const javascript = runtimes.find(runtime => runtime.tioKey === "javascript");
  assert.equal(javascript.baseLanguage, "@js");
  assert.equal(javascript.versions.length, 2);
  const powershell = runtimes.find(runtime => runtime.tioKey === "powershell");
  assert.equal(powershell.baseLanguage, "powershell");
  assert.equal(powershell.versions.length, 2);
  assert.equal(runtimes.filter(runtime => runtime.baseLanguage === "powershell").length, 1);
  assert.equal(runtimes.find(runtime => runtime.tioKey === "coq").starter, undefined);
  assert.equal(runtimes.find(runtime => runtime.tioKey === "raku").baseLanguage, "raku");
  assert.deepEqual(runtimes.find(runtime => runtime.tioKey === "perl").versions.map(version => version.id), ["perl"]);
  assert.equal(runtimes.find(runtime => runtime.tioKey === "befunge-93").baseLanguage, "befunge93");
  assert.equal(runtimes.find(runtime => runtime.tioKey === "jelly").baseLanguage, "jelly");
  assert.equal(runtimes.find(runtime => runtime.tioKey === "lolcode").baseLanguage, "lolcode");
  assert.ok(!runtimes.some(runtime => runtime.tioKey === "other"));
  assert.ok(!runtimes.some(runtime => runtime.tioKey === "experimental only"));
});

test("execution submits the selected implementation, source, and stdin", async () => {
  const { calls, fetchImpl } = fakeFetchFor(encodeResult("Hello, Ada!\n", "Exit code 3", "warning\n"));
  const result = await execute({
    language: "tio:python",
    version: "python3-pypy",
    files: [{ name: "main.py", content: "print(input())" }],
    stdin: "Ada"
  }, fetchImpl);
  const call = calls.find(item => item.state);
  assert.match(call.url, /^https:\/\/tio\.run\/run\/[a-f0-9]{32}$/);
  assert.match(call.state, /Vlang\x001\x00python3-pypy\x00/);
  assert.match(call.state, /F\.code\.tio\0\d+\0print\(input\(\)\)/);
  assert.match(call.state, /F\.input\.tio\x003\x00Ada/);
  assert.equal(result.run.stdout, "Hello, Ada!\n");
  assert.equal(result.run.stderr, "warning\n");
  assert.equal(result.run.code, 3);
});

test("unsupported TIO implementations and invalid requests fail explicitly", async () => {
  const { fetchImpl } = fakeFetchFor(encodeResult("", "Exit code 0"));
  await assert.rejects(execute({
    language: "tio:python",
    version: "not-a-python-runtime",
    files: [{ name: "main.py", content: "print(1)" }]
  }, fetchImpl), error => error instanceof TioError && error.status === 400);
  await assert.rejects(execute({
    language: "tio:python",
    files: []
  }, fetchImpl), error => error instanceof TioError && error.status === 400);
});

test("Pages function rejects cross-origin requests", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("Rejected origin must not call the provider.");
  };
  try {
    const request = new Request("https://sprig-online-compiler.pages.dev/api/v2/tio/execute", {
      method: "POST",
      headers: {
        Origin: "https://other.example",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ language: "tio:python", files: [{ content: "print(1)" }] })
    });
    const response = await onRequest({ request, params: { path: "execute" } });
    assert.equal(response.status, 403);
    assert.match((await response.json()).message, /Origin not allowed/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Pages function returns TIO results for same-origin requests", async () => {
  const originalFetch = globalThis.fetch;
  const { calls, fetchImpl } = fakeFetchFor(encodeResult("Hello from TIO\n", "Exit code 0"));
  globalThis.fetch = fetchImpl;
  try {
    const request = new Request("https://sprig-online-compiler.pages.dev/api/v2/tio/execute", {
      method: "POST",
      headers: {
        Origin: "https://sprig-online-compiler.pages.dev",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        language: "tio:python",
        version: "python3",
        files: [{ name: "main.py", content: "print('Hello from TIO')" }],
        stdin: ""
      })
    });
    const response = await onRequest({ request, params: { path: "execute" } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://sprig-online-compiler.pages.dev");
    assert.equal((await response.json()).run.stdout, "Hello from TIO\n");
    assert.ok(calls.some(call => call.state));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
