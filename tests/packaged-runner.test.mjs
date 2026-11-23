import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import path from "node:path";
import test from "node:test";

const executable = process.env.SPRIG_PACKAGED_EXE;

test("packaged runner serves the editor and accepts a PowerShell prompt", {
  skip: process.platform !== "win32" || !executable, timeout: 30000
}, async () => {
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const script = path.join(path.dirname(executable), "resources", "app", "sprig-runner.js");
  const runner = spawn(executable, [script], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", SPRIG_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true
  });
  let logs = "";
  runner.stdout.on("data", chunk => { logs += chunk; });
  runner.stderr.on("data", chunk => { logs += chunk; });
  try {
    for (let i = 0; i < 100 && !logs.includes("listening"); i++) {
      if (runner.exitCode !== null) throw new Error("Packaged runner exited: " + logs);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.match(logs, /listening/);
    const base = `http://127.0.0.1:${port}`;
    assert.match(await (await fetch(base + "/")).text(), /Sprig/);
    assert.equal((await fetch(base + "/vendor/marked.min.js")).status, 200);
    const session = "packaged-prompt";
    const response = await fetch(base + "/api/v2/execute", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: "powershell", files: [{ content: '$name = Read-Host "Your name"\nWrite-Output "Hello $name"' }],
        interactive: true, session, allowInstall: false })
    });
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let output = "", buffer = "", sent = false, exit;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const row = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (!row.trim()) continue;
        const event = JSON.parse(row);
        output += (event.stdout || "") + (event.stderr || "") + (event.message || "");
        if (typeof event.exit === "number") exit = event.exit;
        if (!sent && /Your name/i.test(output)) {
          sent = true;
          const input = await fetch(base + "/api/v2/stdin", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session, data: "Ada\n" })
          });
          assert.equal((await input.json()).ok, true);
        }
      }
    }
    assert.equal(sent, true, output);
    assert.equal(exit, 0, output);
    assert.match(output, /Hello Ada/);
  } finally {
    if (runner.exitCode === null) {
      const closed = once(runner, "close");
      runner.kill();
      await closed;
    }
  }
});
