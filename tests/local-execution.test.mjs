import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const runner = await readFile(new URL("../server/sprig-runner.js", import.meta.url), "utf8");
const start = runner.indexOf("async function execute(payload)");
const end = runner.indexOf("const server = ", start);
assert.ok(start >= 0 && end > start);
const flushStart = runner.indexOf("function flushSession(");
const flushEnd = runner.indexOf("function pushStdin(", flushStart);
assert.ok(flushStart >= 0 && flushEnd > flushStart);

function harness({ compiled = false, finish }) {
  const removed = [], sessions = new Map(), spawned = [], input = [];
  const context = vm.createContext({
    localCommand: async () => ["runtime"], commandAvailable: async () => true,
    createLocalPlan: () => ({ dir: "temporary-run", args: ["file"], compiler: "compiler",
      compiledArgs: compiled ? ["file"] : null }),
    fs: { existsSync: () => true, rmSync: dir => removed.push(dir) },
    path, process: { platform: "win32", env: {} }, sessions,
    setTimeout, clearTimeout,
    spawn: command => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.stdin = new EventEmitter(); child.stdin.writable = true;
      child.stdin.end = () => {}; child.stdin.write = value => input.push({ command, value });
      child.kill = () => {};
      spawned.push(command);
      setImmediate(() => finish(child, command));
      return child;
    }
  });
  vm.runInContext(runner.slice(flushStart, flushEnd) + runner.slice(start, end), context);
  return { context, removed, sessions, spawned, input };
}

test("a missing compiler reports an error and removes temporary files", async () => {
  const { context, removed } = harness({ compiled: true, finish(child) {
    child.emit("error", new Error("compiler not found"));
    child.emit("close", null, null);
  } });
  const result = await context.execute({ language: "java", files: [{ content: "" }] });
  assert.equal(result.compile.code, 1);
  assert.match(result.compile.stderr, /compiler not found/);
  assert.deepEqual(removed, ["temporary-run"]);
});

test("a killed program reports failure rather than a successful exit", async () => {
  const { context, removed } = harness({ finish(child) { child.emit("close", null, "SIGTERM"); } });
  const result = await context.execute({ language: "node", files: [{ content: "" }] });
  assert.equal(result.run.code, 1);
  assert.equal(result.run.signal, "SIGTERM");
  assert.deepEqual(removed, ["temporary-run"]);
});

test("interactive compilation starts the program after the compiler exits", async () => {
  let context, sessions;
  const h = harness({ compiled: true, finish(child, command) {
    if (command === "compiler") {
      sessions.get("test").queue.push("hello\n");
      context.flushSession(sessions.get("test"));
    }
    child.emit("close", 0, null);
  } });
  ({ context, sessions } = h);
  sessions.set("test", { child: null, queue: [], closed: false });
  const result = await context.execute({ language: "c", interactive: true, session: "test", files: [{ content: "" }] });
  assert.equal(result.run.code, 0);
  assert.equal(h.spawned.length, 2);
  assert.deepEqual(h.input, [{ command: h.spawned[1], value: "hello\n" }]);
  assert.deepEqual(h.removed, ["temporary-run"]);
});

test("SQLite runs the source as SQL and reports syntax errors", {
  skip: spawnSync("docker", ["image", "inspect", "sprig-ai-languages:1"], { stdio: "ignore" }).status !== 0
}, () => {
  const planStart = runner.indexOf("function createLocalPlan(");
  const planEnd = runner.indexOf("async function launchNativeTerminal(", planStart);
  const files = new Map();
  const context = vm.createContext({
    fs: { mkdtempSync: () => "/tmp/sprig-sql-test", writeFileSync: (file, source) => files.set(file, source) },
    path: path.posix, os: { tmpdir: () => "/tmp" }, process: { platform: "linux" },
    extensionFor: () => "sql"
  });
  vm.runInContext(runner.slice(planStart, planEnd), context);
  for (const [source, expected] of [["SELECT 42;", 0], ["SELECT INVALID;", 1]]) {
    const plan = context.createLocalPlan("sqlite3", ["sqlite3"], source);
    const result = spawnSync("docker", ["run", "--rm", "--network", "none", "-i", "--entrypoint", "/bin/sh",
      "sprig-ai-languages:1", "-c", 'mkdir -p /tmp/sprig-sql-test; cat > "$1"; shift; exec sqlite3 "$@"',
      "sh", "/tmp/sprig-sql-test/main.sql", ...plan.args], { input: files.get("/tmp/sprig-sql-test/main.sql"), encoding: "utf8" });
    assert.equal(result.status, expected, result.stderr);
    if (expected === 0) assert.equal(result.stdout.trim(), "42");
    else assert.match(result.stderr, /no such column/);
  }
});
