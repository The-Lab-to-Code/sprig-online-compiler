import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import test from "node:test";

const available = process.platform === "win32" &&
  spawnSync("where", ["powershell"], { stdio: "ignore" }).status === 0;

test("PowerShell confirmations accept both yes and no in the terminal", { skip: !available, timeout: 60000 }, async () => {
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const runner = spawn(process.execPath, ["sprig-runner.js"], {
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
    const base = `http://127.0.0.1:${port}`;
    for (const [answer, expected] of [["n", "DECLINED"], ["y", "CONFIRMED"]]) {
      const session = "confirm-" + answer;
      const code = 'function Test-Confirmation { [CmdletBinding(SupportsShouldProcess=$true,ConfirmImpact="High")] param() if ($PSCmdlet.ShouldProcess("a simulated action","Test")) { Write-Output "CONFIRMED" } else { Write-Output "DECLINED" } }\nTest-Confirmation';
      const response = await fetch(base + "/api/v2/execute", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: "powershell", files: [{ content: code }],
          interactive: true, session, allowInstall: false })
      });
      assert.equal(response.status, 200);
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
          if (!sent && /simulated action/i.test(output) && /\[Y\]/i.test(output)) {
            sent = true;
            const input = await fetch(base + "/api/v2/stdin", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ session, data: answer + "\n" })
            });
            assert.equal((await input.json()).ok, true);
          }
        }
      }
      assert.equal(sent, true, output);
      assert.equal(exit, 0, output);
      assert.match(output, new RegExp(expected));
      assert.doesNotMatch(output, /\x1b/);
    }
  } finally {
    if (runner.exitCode === null) {
      const closed = once(runner, "close"); runner.kill(); await closed;
    }
  }
});
