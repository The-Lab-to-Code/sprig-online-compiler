import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("terminal settings persist, validate, and run custom argument arrays", { timeout: 45000 }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "sprig-settings-test-"));
  const runner = spawn(process.execPath, ["sprig-runner.js"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, SPRIG_PORT: "0", SPRIG_SETTINGS_DIR: dir }, stdio: ["ignore", "pipe", "pipe"]
  });
  let logs = "", terminalPid;
  runner.stdout.on("data", chunk => { logs += chunk; });
  runner.stderr.on("data", chunk => { logs += chunk; });
  try {
    for (let i = 0; i < 100 && !logs.includes("listening"); i++) await new Promise(resolve => setTimeout(resolve, 50));
    const base = logs.match(/listening on (http:\/\/127\.0\.0\.1:\d+)\/\s*/)?.[1];
    assert.ok(base, logs);
    const request = (endpoint, payload, origin = base) => fetch(base + endpoint, {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(payload)
    });
    const languages = [{ id: "js", runtime: "node", extension: "js" }, { id: "mystery", runtime: "unknown", extension: "txt" }];
    assert.equal((await request("/api/v2/terminal-settings", { action: "load", languages }, "https://example.com")).status, 403);
    const loaded = await (await request("/api/v2/terminal-settings", { action: "load", languages })).json();
    assert.equal(loaded.settings.languages.mystery, null);
    assert.deepEqual(loaded.settings.languages.js.run, ["node", "{file}"]);
    const marker = path.join(dir, "result with space.txt");
    loaded.settings.languages.mystery = { extension: "txt", compile: null,
      run: [process.execPath, "-e", "require('fs').writeFileSync(process.argv[1],process.argv[2])", marker, "a 'quoted' value"] };
    assert.equal((await request("/api/v2/terminal-settings", { action: "save", settings: loaded.settings })).status, 200);
    const invalid = structuredClone(loaded.settings);
    invalid.languages.js.run = "node {file}";
    assert.equal((await request("/api/v2/terminal-settings", { action: "save", settings: invalid })).status, 400);
    const reloaded = await (await request("/api/v2/terminal-settings", { action: "load", languages })).json();
    assert.deepEqual(reloaded.settings.languages.mystery, loaded.settings.languages.mystery);
    if (process.platform === "win32") {
      const response = await request("/api/v2/native-terminal", { id: "mystery", language: "unknown", source: "hello" });
      const result = await response.json();
      assert.equal(response.status, 200, JSON.stringify(result));
      terminalPid = result.pid;
      for (let i = 0; i < 100 && !existsSync(marker); i++) await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(readFileSync(marker, "utf8"), "a 'quoted' value");
    }
  } finally {
    if (terminalPid) execFileSync("powershell.exe", ["-NoProfile", "-Command", `Stop-Process -Id ${terminalPid} -Force -ErrorAction SilentlyContinue`]);
    runner.kill();
    await new Promise(resolve => runner.once("exit", resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
