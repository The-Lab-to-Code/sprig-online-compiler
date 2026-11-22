import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../functions/api/v2/piston/[[path]].js", import.meta.url), "utf8");
const { onRequest } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const siteOrigin = "https://sprig-online-compiler.pages.dev";

function context(path, method, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.origin !== undefined) headers.set("Origin", options.origin);
  const request = new Request("https://sprig-online-compiler.pages.dev/api/v2/piston/" + path, {
    method,
    headers,
    body: options.body
  });
  return {
    request,
    env: {
      SITE_ORIGIN: siteOrigin,
      ONLINECOMPILER_API_KEY: options.apiKey
    },
    params: { path }
  };
}

test("proxies an execution with the API key kept server-side", async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return new Response('{"language":"powershell","run":{"stdout":"ok"}}', {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  try {
    const response = await onRequest(context("execute", "POST", {
      origin: siteOrigin,
      apiKey: "test-secret",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: "powershell", files: [{ content: "Write-Output ok" }] })
    }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).run.stdout, "ok");
    assert.equal(captured.url, "https://api.onlinecompiler.io/api/v2/piston/execute");
    assert.equal(captured.init.headers.Authorization, "test-secret");
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), siteOrigin);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects requests from other origins without contacting the provider", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("The provider must not be called for a rejected origin.");
  };
  try {
    const response = await onRequest(context("execute", "POST", {
      origin: "https://attacker.example",
      apiKey: "test-secret",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: "powershell", files: [{ content: "Write-Output ok" }] })
    }));
    assert.equal(response.status, 403);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("returns a clear setup error when the API key is missing", async () => {
  const response = await onRequest(context("execute", "POST", {
    origin: siteOrigin,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ language: "powershell", files: [{ content: "Write-Output ok" }] })
  }));
  assert.equal(response.status, 503);
  assert.match((await response.json()).message, /not configured by the site owner/);
});
