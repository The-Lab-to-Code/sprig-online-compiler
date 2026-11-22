import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const runnerPath = path.join(root, "sprig-runner.js");

async function listenOnEphemeralPort(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitForRunner(url, process) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (process.exitCode !== null) throw new Error("Sprig runner exited during startup.");
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Sprig runner did not become ready.");
}

test("the private runner proxies Piston runtime discovery and execution", async t => {
  let executePayload;
  const piston = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "GET" && req.url === "/api/v2/runtimes") {
      return res.end(JSON.stringify([{ language: "powershell", version: "7.1.4", aliases: ["pwsh"] }]));
    }
    if (req.method === "POST" && req.url === "/api/v2/execute") {
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        executePayload = JSON.parse(body);
        res.end(JSON.stringify({ run: { stdout: "SPRIG_PISTON_OK\n", stderr: "", code: 0 } }));
      });
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ message: "Not found" }));
  });

  const pistonPort = await listenOnEphemeralPort(piston);
  piston.listen(pistonPort, "127.0.0.1");
  await once(piston, "listening");
  t.after(() => new Promise(resolve => piston.close(resolve)));

  const runnerPort = await listenOnEphemeralPort(createServer());
  const runner = spawn(process.execPath, [runnerPath], {
    cwd: root,
    env: {
      ...process.env,
      PISTON_URL: `http://127.0.0.1:${pistonPort}/api/v2/execute`,
      SPRIG_HOST: "127.0.0.1",
      SPRIG_PORT: String(runnerPort)
    },
    stdio: "ignore"
  });
  t.after(() => runner.kill());

  const runnerOrigin = `http://127.0.0.1:${runnerPort}`;
  await waitForRunner(`${runnerOrigin}/`, runner);

  const runtimesResponse = await fetch(`${runnerOrigin}/api/v2/piston/runtimes`);
  assert.equal(runtimesResponse.status, 200);
  assert.equal((await runtimesResponse.json())[0].language, "powershell");

  const executeResponse = await fetch(`${runnerOrigin}/api/v2/piston/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      language: "powershell",
      version: "*",
      files: [{ name: "main.ps1", content: 'Write-Output "SPRIG_PISTON_OK"' }]
    })
  });
  assert.equal(executeResponse.status, 200);
  assert.equal((await executeResponse.json()).run.stdout, "SPRIG_PISTON_OK\n");
  assert.equal(executePayload.language, "powershell");
});
