import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { execute, listRuntimes, WandboxError } from "../functions/_lib/wandbox.mjs";

const functionFile = new URL("../functions/api/v2/piston/[[path]].js", import.meta.url);
const functionSource = await readFile(functionFile, "utf8");
const sharedModule = new URL("../functions/_lib/wandbox.mjs", import.meta.url).href;
const pageFunctionSource = functionSource.replace(
  '"../../../_lib/wandbox.mjs"',
  JSON.stringify(sharedModule)
);
const { onRequest } = await import(`data:text/javascript;base64,${Buffer.from(pageFunctionSource).toString("base64")}`);

const compilers = [
  { name: "cpython-head", language: "Python", version: "" },
  { name: "cpython-3.13.0", language: "Python", version: "3.13.0" },
  { name: "cpython-2.7-head", language: "Python", version: "" },
  { name: "gcc-head", language: "C++", version: "17 experimental" },
  { name: "gcc-13.2.0", language: "C++", version: "13.2.0" },
  { name: "nodejs-20.17.0", language: "JavaScript", version: "20.17.0" },
  { name: "vim-9.1", language: "Vim script", version: "9.1" },
  { name: "lazyk", language: "Lazy K", version: "" },
  { name: "openssl-3", language: "OpenSSL", version: "3" }
];

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function fakeFetchFor(result = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/list.json")) return jsonResponse(compilers);
    if (String(url).endsWith("/compile.json")) return jsonResponse({
      status: "0",
      compiler_output: "",
      compiler_error: "",
      program_output: "hello\n",
      program_error: "",
      ...result
    });
    throw new Error(`Unexpected request: ${url}`);
  };
  return { calls, fetchImpl };
}

test("runtime discovery groups compiler versions by language family", async () => {
  const { fetchImpl } = fakeFetchFor();
  const runtimes = await listRuntimes(fetchImpl);
  const cxx = runtimes.find(runtime => runtime.baseLanguage === "c++");
  assert.equal(cxx.provider, "wandbox");
  assert.equal(cxx.defaultVersion, "gcc-13.2.0");
  assert.ok(cxx.versions.some(version => version.id === "gcc-13.2.0"));
  assert.ok(runtimes.find(runtime => runtime.baseLanguage === "python2").versions
    .some(version => version.id === "cpython-2.7-head"));
  assert.ok(runtimes.some(runtime => runtime.baseLanguage === "vimscript"));
  assert.match(runtimes.find(runtime => runtime.baseLanguage === "openssl").starter, /Hello, World!/);
});

test("Lazy K starter produces a hello world stream", async () => {
  const { fetchImpl } = fakeFetchFor();
  const runtimes = await listRuntimes(fetchImpl);
  const code = runtimes.find(runtime => runtime.baseLanguage === "lazyk").starter;
  let position = 0;
  function parse() {
    const token = code[position++];
    if (token === "`") return [parse(), parse()];
    assert.ok(["s", "k", "i"].includes(token));
    return token;
  }
  const program = parse();
  assert.equal(position, code.length);
  const apply = (fn, arg) => [fn, arg];
  let steps = 0;
  function evaluate(expression) {
    const args = [];
    for (;;) {
      assert.ok(++steps < 10000000, "Lazy K evaluation exceeded the step limit");
      if (Array.isArray(expression)) {
        args.push(expression[1]);
        expression = expression[0];
      } else if (expression === "i" && args.length) {
        expression = args.pop();
      } else if (expression === "k" && args.length >= 2) {
        expression = args.pop();
        args.pop();
      } else if (expression === "s" && args.length >= 3) {
        const a = args.pop(), b = args.pop(), c = args.pop();
        expression = apply(apply(a, c), apply(b, c));
      } else if (typeof expression === "function" && args.length) {
        expression = expression(args.pop());
      } else {
        while (args.length) expression = apply(expression, args.pop());
        return expression;
      }
    }
  }
  let stream = evaluate(apply(program, "i"));
  let output = "";
  for (let count = 0; count < 100; count++) {
    const head = evaluate(apply(stream, "k"));
    const byte = evaluate(apply(apply(head, value => evaluate(value) + 1), 0));
    assert.equal(typeof byte, "number");
    if (byte >= 256) break;
    output += String.fromCharCode(byte);
    stream = evaluate(apply(stream, apply("k", "i")));
  }
  assert.equal(output, "Hello, World!\n");
});

test("execution chooses a stable Python compiler and forwards source and stdin", async () => {
  const { calls, fetchImpl } = fakeFetchFor();
  const result = await execute({
    language: "python",
    files: [{ name: "main.py", content: "print(input())" }],
    stdin: "hello"
  }, fetchImpl);
  const compileCall = calls.find(call => call.url.endsWith("/compile.json"));
  const body = JSON.parse(compileCall.init.body);
  assert.equal(body.compiler, "cpython-3.13.0");
  assert.equal(body.code, "print(input())");
  assert.equal(body.stdin, "hello");
  assert.equal(body.save, false);
  assert.equal(result.run.stdout, "hello\n");
  assert.equal(result.run.code, 0);
});

test("execution accepts a selected compiler version", async () => {
  const { calls, fetchImpl } = fakeFetchFor();
  await execute({
    language: "wandbox:gcc-13.2.0",
    files: [{ name: "main.cpp", content: "int main() {}" }]
  }, fetchImpl);
  const compileCall = calls.find(call => call.url.endsWith("/compile.json"));
  assert.equal(JSON.parse(compileCall.init.body).compiler, "gcc-13.2.0");
});

test("compiler errors are returned in Piston response form", async () => {
  const { fetchImpl } = fakeFetchFor({
    status: "1",
    compiler_error: "syntax error",
    program_output: ""
  });
  const result = await execute({
    language: "c++",
    files: [{ name: "main.cpp", content: "not valid" }]
  }, fetchImpl);
  assert.equal(result.compile.code, 1);
  assert.equal(result.compile.stderr, "syntax error");
});

test("compiler diagnostics on stdout are preserved without duplicating combined messages", async () => {
  const { fetchImpl } = fakeFetchFor({
    status: "1", compiler_output: "Module name does not match file name\n",
    compiler_message: "Module name does not match file name\n", program_output: ""
  });
  const result = await execute({ language: "c++", files: [{ content: "example" }] }, fetchImpl);
  assert.equal(result.compile.code, 1);
  assert.match(result.compile.stdout, /Module name/);
  assert.equal(result.compile.stderr, "");
});

test("invalid and unsupported requests fail explicitly", async () => {
  const { fetchImpl } = fakeFetchFor();
  await assert.rejects(
    execute({ language: "python", files: [] }, fetchImpl),
    error => error instanceof WandboxError && error.status === 400
  );
  await assert.rejects(
    execute({ language: "powershell", files: [{ content: "Write-Output ok" }] }, fetchImpl),
    error => error instanceof WandboxError && error.status === 400
  );
});

test("Pages function rejects cross-origin requests", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("Rejected origin must not call the provider.");
  };
  try {
    const request = new Request("https://sprig-online-compiler.pages.dev/api/v2/piston/execute", {
      method: "POST",
      headers: {
        Origin: "https://other.example",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ language: "python", files: [{ content: "print(1)" }] })
    });
    const response = await onRequest({ request, params: { path: "execute" } });
    assert.equal(response.status, 403);
    assert.match((await response.json()).message, /Origin not allowed/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Pages function returns a Piston-compatible result for execution", async () => {
  const originalFetch = globalThis.fetch;
  const { fetchImpl } = fakeFetchFor();
  globalThis.fetch = fetchImpl;
  try {
    const request = new Request("https://sprig-online-compiler.pages.dev/api/v2/piston/execute", {
      method: "POST",
      headers: {
        Origin: "https://sprig-online-compiler.pages.dev",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        language: "python",
        files: [{ name: "main.py", content: "print('hello')" }],
        stdin: ""
      })
    });
    const response = await onRequest({ request, params: { path: "execute" } });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.compile.code, 0);
    assert.equal(result.run.stdout, "hello\n");
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://sprig-online-compiler.pages.dev");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
