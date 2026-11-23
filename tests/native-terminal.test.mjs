import assert from "node:assert/strict";
import { spawn, execFileSync, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const available = process.platform === "win32" &&
  spawnSync("where", ["powershell"], { stdio: "ignore" }).status === 0;

test("the separate terminal runs locally and rejects cross-origin requests", { skip: !available, timeout: 30000 }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "sprig-terminal-test-"));
  const marker = path.join(dir, "result.txt");
  const runner = spawn(process.execPath, ["sprig-runner.js"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, SPRIG_PORT: "0" }, stdio: ["ignore", "pipe", "pipe"]
  });
  let logs = "", terminalId;
  const terminalIds = [];
  runner.stdout.on("data", chunk => { logs += chunk; });
  runner.stderr.on("data", chunk => { logs += chunk; });
  try {
    for (let i = 0; i < 100 && !logs.includes("listening"); i++) {
      if (runner.exitCode !== null) throw new Error("Runner exited: " + logs);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.match(logs, /listening/);
    const base = logs.match(/listening on (http:\/\/127\.0\.0\.1:\d+)\/\s*/)?.[1];
    assert.ok(base, logs);
    const code = `Write-Output 'SPRIG TERMINAL OK'\n$name = Read-Host 'Your name'\nSet-Content -LiteralPath '${marker.replace(/'/g, "''")}' -Value $name`;
    const request = (origin, payload) => fetch(base + "/api/v2/native-terminal", {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    assert.equal((await request("https://example.com", { language: "powershell", source: code })).status, 403);
    assert.equal((await request(base, { language: "constructor", source: code })).status, 400);
    const response = await request(base, { language: "powershell", source: code });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(result.ok, true);
    assert.ok(Number.isInteger(result.pid));
    terminalId = result.pid;
    terminalIds.push(terminalId);
    const probe = `
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class ConsoleProbe {
  [DllImport("kernel32.dll")] public static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AttachConsole(uint id);
  [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern IntPtr CreateFile(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
  [StructLayout(LayoutKind.Sequential)] public struct Coord { public short x, y; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct Key { public int down; public ushort repeat, key, scan; public char character; public uint state; }
  [StructLayout(LayoutKind.Explicit)] public struct Input { [FieldOffset(0)] public ushort type; [FieldOffset(4)] public Key key; }
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool ReadConsoleOutputCharacter(IntPtr handle, StringBuilder text, uint length, Coord offset, out uint read);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool WriteConsoleInput(IntPtr handle, Input[] input, uint length, out uint written);
}
'@
[void][ConsoleProbe]::FreeConsole()
if (-not [ConsoleProbe]::AttachConsole(${terminalId})) { throw "Could not attach to terminal console." }
$window = [ConsoleProbe]::GetConsoleWindow()
if ($window -eq [IntPtr]::Zero -or -not [ConsoleProbe]::IsWindowVisible($window)) { throw "Terminal window is not visible." }
$output = [ConsoleProbe]::CreateFile("CONOUT$", [uint32]2147483648, 3, [IntPtr]::Zero, 3, 0, [IntPtr]::Zero)
$inputHandle = [ConsoleProbe]::CreateFile("CONIN$", [uint32]3221225472, 3, [IntPtr]::Zero, 3, 0, [IntPtr]::Zero)
$found = $false
for ($i = 0; $i -lt 100; $i++) {
  $text = [System.Text.StringBuilder]::new(12000)
  $read = [uint32]0
  if (-not [ConsoleProbe]::ReadConsoleOutputCharacter($output, $text, 12000, [ConsoleProbe+Coord]::new(), [ref]$read)) { throw "Could not read terminal output." }
  if ($text.ToString().Contains("SPRIG TERMINAL OK") -and $text.ToString().Contains("Your name")) { $found = $true; break }
  Start-Sleep -Milliseconds 100
}
if (-not $found) { throw "Program output or prompt did not appear in the terminal." }
$records = @()
foreach ($character in "Ada\`r".ToCharArray()) {
  $key = [ConsoleProbe+Key]::new()
  $key.down = 1; $key.repeat = 1; $key.character = $character
  if ($character -eq "\`r") { $key.key = 13 }
  $record = [ConsoleProbe+Input]::new(); $record.type = 1; $record.key = $key
  $records += $record
}
$written = [uint32]0
if (-not [ConsoleProbe]::WriteConsoleInput($inputHandle, $records, $records.Length, [ref]$written) -or $written -ne $records.Length) { throw "Could not send terminal input." }
Write-Output "visible and interactive"
`;
    const visibility = execFileSync("powershell.exe", ["-NoProfile", "-Command", probe], { encoding: "utf8" }).trim();
    assert.equal(visibility, "visible and interactive");
    for (let i = 0; i < 100 && !existsSync(marker); i++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(existsSync(marker), "Program did not finish. Terminal process: " + terminalId + ". " + logs);
    assert.equal(readFileSync(marker, "utf8").trim(), "Ada");
    if (spawnSync("where", ["gcc"], { stdio: "ignore" }).status === 0) {
      const compiledMarker = path.join(dir, "compiled.txt");
      const c = `#include <stdio.h>\nint main(void) { FILE *f = fopen(${JSON.stringify(compiledMarker)}, "w"); if (!f) return 1; fputs("compiled", f); return fclose(f); }`;
      const compiledResponse = await request(base, { language: "c", source: c });
      const compiledResult = await compiledResponse.json();
      assert.equal(compiledResponse.status, 200, JSON.stringify(compiledResult));
      terminalIds.push(compiledResult.pid);
      for (let i = 0; i < 100 && !existsSync(compiledMarker); i++) await new Promise(resolve => setTimeout(resolve, 100));
      assert.ok(existsSync(compiledMarker), "Compiled program did not finish. " + logs);
      assert.equal(readFileSync(compiledMarker, "utf8"), "compiled");
    }
  } finally {
    for (const id of terminalIds) execFileSync("powershell.exe", ["-NoProfile", "-Command",
      `$p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${id}'; if ($p -and $p.CommandLine -match 'run-in-terminal\\.ps1') { Stop-Process -Id ${id} }`]);
    if (runner.exitCode === null) {
      const closed = once(runner, "close");
      runner.kill();
      await closed;
    }
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
