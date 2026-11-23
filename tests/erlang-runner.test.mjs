import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const lookup = process.platform === "win32" ? "where" : "which";
const available = ["erl", "erlc"].every(command => spawnSync(lookup, [command], { stdio: "ignore" }).status === 0);

test("the TIO Erlang starter runs as an escript", {
  skip: spawnSync(lookup, ["escript"], { stdio: "ignore" }).status !== 0
}, async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const starter = html.match(/'erlang\|Erlang\|erlang\|erl\|([^']*)'/);
  assert.ok(starter);
  const temp = await mkdtemp(path.join(os.tmpdir(), "sprig-erlang-escript-"));
  try {
    const file = path.join(temp, "starter.escript");
    await writeFile(file, starter[1].replaceAll("¶", "\n"));
    const result = spawnSync("escript", [file], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "Hello, World!\n");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("local Erlang runs programs using their declared module name", { skip: !available, timeout: 60000 }, async () => {
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const temp = await mkdtemp(path.join(os.tmpdir(), "sprig-erlang-test-"));
  const runner = spawn(process.execPath, ["sprig-runner.js"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, SPRIG_PORT: String(port), TEMP: temp, TMP: temp, TMPDIR: temp },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let logs = "";
  runner.stdout.on("data", chunk => { logs += chunk; });
  runner.stderr.on("data", chunk => { logs += chunk; });
  try {
    const mismatch = path.join(temp, "prog.erl");
    await writeFile(mismatch, '-module(main).\n-export([main/0]).\nmain() -> ok.\n');
    const compile = spawnSync("erlc", [mismatch], { cwd: temp, encoding: "utf8" });
    assert.notEqual(compile.status, 0);
    assert.match(compile.stdout + compile.stderr, /module name.*does not match file name/i);
    for (let attempt = 0; attempt < 100 && !logs.includes("listening"); attempt++) {
      if (runner.exitCode !== null) throw new Error("Runner exited: " + logs);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.match(logs, /listening/);
    for (const moduleName of ["main", "prog"]) {
      const response = await fetch(`http://127.0.0.1:${port}/api/v2/execute`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: "erlang", allowInstall: false,
          files: [{ content: `-module(${moduleName}).\n-export([main/0]).\nmain() -> io:format("ok~n").` }]
        })
      });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.compile?.code || 0, 0, JSON.stringify(result));
      assert.equal(result.run?.code, 0, JSON.stringify(result));
      assert.equal(result.run?.stdout, "ok\n");
    }
  } finally {
    if (runner.exitCode === null) {
      const closed = once(runner, "close"); runner.kill(); await closed;
    }
    await rm(temp, { recursive: true, force: true });
  }
});
