import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const executable = process.env.SPRIG_PACKAGED_EXE;

test("the packaged executable and window use the Sprig icon", {
  skip: process.platform !== "win32" || !executable
}, () => {
  const image = path.join(path.dirname(executable), "resources", "app", "desktop", "icon.png");
  assert.deepEqual(readFileSync(image), readFileSync(new URL("../desktop/icon.png", import.meta.url)));
  const color = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command", `
    Add-Type -AssemblyName System.Drawing
    $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($env:SPRIG_PACKAGED_EXE)
    $bitmap = $icon.ToBitmap()
    try {
      $pixel = $bitmap.GetPixel([int]($bitmap.Width / 2), [int]($bitmap.Height / 2))
      ConvertTo-Json -Compress -InputObject @($pixel.R, $pixel.G, $pixel.B)
    } finally { $bitmap.Dispose(); $icon.Dispose() }
  `], { encoding: "utf8" }));
  assert.ok(color[1] > color[0] && color[1] > color[2], "Executable icon is missing its green mark");
});

async function unusedPort() {
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  return port;
}

test("packaged app opens an isolated editor window and runs code", {
  skip: process.platform !== "win32" || !executable, timeout: 60000
}, async () => {
  const port = await unusedPort(), debugPort = await unusedPort();
  const profile = mkdtempSync(path.join(os.tmpdir(), "sprig-desktop-test-"));
  const env = { ...process.env, SPRIG_PORT: String(port) };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, ["--remote-debugging-port=" + debugPort, "--user-data-dir=" + profile], {
    env,
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true
  });
  let logs = "", socket, runnerIds = [];
  child.stdout.on("data", chunk => { logs += chunk; });
  child.stderr.on("data", chunk => { logs += chunk; });
  try {
    let target;
    for (let i = 0; i < 150 && !target; i++) {
      if (child.exitCode !== null) throw new Error("Desktop app exited: " + logs);
      try {
        const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
        target = pages.find(page => page.type === "page" && page.url.startsWith(`http://127.0.0.1:${port}/`));
      } catch {}
      if (!target) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(target, "Editor window did not appear: " + logs);
    assert.match(target.url, /#editor$/);
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await once(socket, "open");
    let nextId = 0;
    const pending = new Map();
    socket.addEventListener("message", event => {
      const message = JSON.parse(event.data), resolve = pending.get(message.id);
      if (resolve) { pending.delete(message.id); resolve(message); }
    });
    const call = (method, params = {}) => new Promise(resolve => {
      const id = ++nextId;
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const response = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      assert.equal(response.error, undefined, JSON.stringify(response));
      assert.equal(response.result.exceptionDetails, undefined, JSON.stringify(response));
      return response.result.result.value;
    };
    let editorReady = false;
    for (let i = 0; i < 100 && !editorReady; i++) {
      editorReady = await evaluate('!!document.querySelector("#app") && document.readyState === "complete"');
      if (!editorReady) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(editorReady, true, "Editor did not finish loading: " + logs);
    const features = await evaluate(`({
      editor: getComputedStyle(document.querySelector("#app")).display,
      node: typeof require,
      open: typeof showOpenFilePicker,
      save: typeof showSaveFilePicker,
      folder: typeof showDirectoryPicker
    })`);
    assert.equal(features.editor, "flex");
    assert.equal(features.node, "undefined");
    assert.equal(features.open, "function");
    assert.equal(features.save, "function");
    assert.equal(features.folder, "function");
    for (let i = 0; i < 100 && await evaluate("ORDER.length") < 200; i++)
      await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(await evaluate("ORDER.length") >= 200, "Bundled language list did not load");
    assert.equal(await evaluate('ORDER.some(id => L[id].name === "Ada")'), true);
    const routing = await evaluate(`({
      javascript: autoChoice(L.js), c: autoChoice(L.c), powershell: autoChoice(L.pwsh),
      flix: autoChoice(L.flix),
      catalogRequests: performance.getEntriesByType("resource").filter(entry => /\\/api\\/v2\\/.*\\/runtimes/.test(entry.name)).length
    })`);
    assert.deepEqual(routing, { javascript: "browser", c: "wandbox", powershell: "tio", flix: "local", catalogRequests: 0 });
    const crystal = await evaluate(`(async () => {
      const originalFetch=window.fetch;
      let request;
      window.fetch=async (url,options)=>{
        if(!String(url).endsWith("/api/v2/tio/execute"))return originalFetch(url,options);
        request=JSON.parse(options.body);
        return new Response(JSON.stringify({compile:{code:0},run:{code:0,stdout:"Hello, World!\\n"}}),
          {headers:{"Content-Type":"application/json"}});
      };
      try {
        setLang("crystal"); await run();
        return {language:request.language,source:request.files[0].content,output:out.textContent};
      } finally {window.fetch=originalFetch;setLang("js")}
    })()`);
    assert.equal(crystal.language, "tio:crystal");
    assert.equal(crystal.source, 'puts "Hello, World!"');
    assert.match(crystal.output, /Hello, World!/);
    await evaluate(`(() => {
      window.savedFetch = window.fetch;
      window.fetch = async (url, options) => {
        if (!String(url).endsWith("/api/v2/ai/generate")) return window.savedFetch(url, options);
        return new Response(new ReadableStream({ start(controller) { window.testAiStream = controller; } }),
          { headers: { "Content-Type": "application/x-ndjson" } });
      };
      showAi(true); document.querySelector("#aiPrompt").value = "Make a test program";
      runAi("generate");
    })()`);
    for (let i = 0; i < 50 && !await evaluate('!!window.testAiStream'); i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(await evaluate('!!window.testAiStream'), true);
    assert.equal(await evaluate('document.querySelector(".ai-progress").getAttribute("aria-valuenow")'), "0");
    await evaluate(`window.testAiStream.enqueue(new TextEncoder().encode(JSON.stringify({
      type:"progress",message:"Finished isolated test 1 of 5.",completedTests:1
    })+"\\n"))`);
    for (let i = 0; i < 50 && await evaluate('document.querySelector(".ai-progress").getAttribute("aria-valuenow")') !== "20"; i++)
      await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(await evaluate('document.querySelector(".ai-progress").getAttribute("aria-valuenow")'), "20");
    assert.match(await evaluate('getComputedStyle(document.querySelector(".ai-progress-dial")).backgroundImage'), /conic-gradient/);
    await evaluate(`(() => {
      window.testAiStream.enqueue(new TextEncoder().encode(JSON.stringify({
        type:"done",text:"Done",verification:{status:"passed",message:"Test passed.",attempts:1}
      })+"\\n")); window.testAiStream.close();
    })()`);
    for (let i = 0; i < 50 && await evaluate('aiBusy'); i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(await evaluate('aiBusy'), false);
    assert.equal(await evaluate('document.querySelector(".ai-progress").getAttribute("aria-valuenow")'), "100");
    await evaluate('window.fetch = window.savedFetch; showAi(false)');
    const original = await evaluate(`(() => {
      const editor = document.querySelector("#code");
      editor.focus(); editor.setSelectionRange(editor.value.length, editor.value.length); return editor.value;
    })()`);
    await call("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "(", code: "Digit9", modifiers: 8, windowsVirtualKeyCode: 57 });
    await call("Input.dispatchKeyEvent", { type: "keyUp", key: "(", code: "Digit9", modifiers: 8, windowsVirtualKeyCode: 57 });
    assert.equal(await evaluate('document.querySelector("#code").value'), original + "()");
    assert.equal(await evaluate('document.querySelector("#code").selectionStart'), original.length + 1);
    assert.equal(await evaluate('document.execCommand("undo")'), true);
    assert.equal(await evaluate('document.querySelector("#code").value'), original);
    await evaluate('tabs[active].dirty = false');
    await evaluate('document.querySelector("#run").click()');
    let output = "";
    for (let i = 0; i < 100 && !output.includes("Hello, Ada!"); i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      output = await evaluate('document.querySelector("#out").textContent');
    }
    assert.match(output, /Hello, Ada!/);
    runnerIds = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command",
      `ConvertTo-Json -InputObject @(Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${child.pid}' | Where-Object { $_.CommandLine -match 'sprig-runner\\.js' } | ForEach-Object { $_.ProcessId }) -Compress`], { encoding: "utf8" }));
    assert.equal(runnerIds.length, 1);
    socket.send(JSON.stringify({ id: ++nextId, method: "Page.close" }));
    let timer;
    try {
      await Promise.race([once(child, "close"), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Desktop did not close")), 10000);
      })]);
    } finally { clearTimeout(timer); }
    assert.equal(child.exitCode, 0, logs);
    const remaining = execFileSync("powershell.exe", ["-NoProfile", "-Command",
      `$p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${runnerIds[0]}'; if ($p -and $p.ParentProcessId -eq ${child.pid} -and $p.CommandLine -match 'sprig-runner\\.js') { 'running' }`], { encoding: "utf8" });
    assert.equal(remaining.trim(), "", "Runner was not stopped with the window");
  } finally {
    if (socket && socket.readyState === WebSocket.OPEN) socket.close();
    if (child.exitCode === null) {
      runnerIds = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command",
        `ConvertTo-Json -InputObject @(Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${child.pid}' | Where-Object { $_.CommandLine -match 'sprig-runner\\.js' } | ForEach-Object { $_.ProcessId }) -Compress`], { encoding: "utf8" }));
      const closed = once(child, "close");
      execFileSync("powershell.exe", ["-NoProfile", "-Command", `Stop-Process -Id ${child.pid}`]);
      await closed;
    }
    for (const id of runnerIds) execFileSync("powershell.exe", ["-NoProfile", "-Command",
      `$p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${id}'; if ($p -and $p.ParentProcessId -eq ${child.pid} -and $p.CommandLine -match 'sprig-runner\\.js') { Stop-Process -Id ${id} }`]);
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
