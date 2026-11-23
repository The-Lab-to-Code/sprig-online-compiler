const { spawn } = require("child_process");
const { randomUUID } = require("crypto");
const { stripVTControlCharacters } = require("util");

class CommandError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

class CodeFormatError extends Error {}

const environments = {
  javascript: { image: "node:24-alpine", command: "cat > /tmp/main.js && exec node /tmp/main.js", labels: ["", "js", "javascript", "node", "nodejs"] },
  "node.js": { image: "node:24-alpine", command: "cat > /tmp/main.js && exec node /tmp/main.js", labels: ["", "js", "javascript", "node", "nodejs"] },
  typescript: { image: "sprig-ai-typescript:1", command: "cat > /tmp/main.ts && tsc --skipLibCheck --target es2022 --module commonjs --outDir /tmp/out /tmp/main.ts && exec node /tmp/out/main.js", labels: ["", "ts", "typescript"], timeout: 60000 },
  python: { image: "python:3.14-alpine", command: "cat > /tmp/main.py && exec python /tmp/main.py", labels: ["", "py", "python", "python3"] },
  "python 3": { image: "python:3.14-alpine", command: "cat > /tmp/main.py && exec python /tmp/main.py", labels: ["", "py", "python", "python3"] },
  c: { image: "gcc:15", command: "cat > /tmp/main.c && gcc /tmp/main.c -o /tmp/main && exec /tmp/main", labels: ["", "c"], timeout: 60000 },
  "c++": { image: "gcc:15", command: "cat > /tmp/main.cpp && g++ /tmp/main.cpp -o /tmp/main && exec /tmp/main", labels: ["", "cpp", "c++", "cxx"], timeout: 60000 },
  fortran: { image: "gcc:15", command: "cat > /tmp/main.f90 && gfortran /tmp/main.f90 -o /tmp/main && exec /tmp/main", labels: ["", "fortran", "f90", "f95"], timeout: 60000 },
  go: { image: "golang:1.25-alpine", command: "cat > /tmp/main.go && GOCACHE=/tmp/gocache GOPATH=/tmp/go GOPROXY=off go run /tmp/main.go", labels: ["", "go", "golang"], timeout: 90000 },
  rust: { image: "rust:1-slim", command: "cat > /tmp/main.rs && rustc /tmp/main.rs -o /tmp/main && exec /tmp/main", labels: ["", "rust", "rs"], timeout: 60000 },
  java: { image: "eclipse-temurin:21-jdk-alpine", command: "cat > /tmp/Main.java && exec java -XX:ActiveProcessorCount=1 -Xmx128m /tmp/Main.java", labels: ["", "java"], timeout: 60000 },
  ruby: { image: "ruby:3.4-alpine", command: "cat > /tmp/main.rb && exec ruby /tmp/main.rb", labels: ["", "ruby", "rb"] },
  php: { image: "php:8.4-cli-alpine", command: "cat > /tmp/main.php && exec php /tmp/main.php", labels: ["", "php"] },
  bash: { image: "gcc:15", command: "cat > /tmp/main.sh && exec bash /tmp/main.sh", labels: ["", "bash", "sh", "shell"] },
  dash: { image: "gcc:15", command: "cat > /tmp/main.sh && exec dash /tmp/main.sh", labels: ["", "dash", "sh", "shell"] },
  perl: { image: "gcc:15", command: "cat > /tmp/main.pl && exec perl /tmp/main.pl", labels: ["", "perl", "pl"] },
  awk: { image: "gcc:15", command: "cat > /tmp/main.awk && exec awk -f /tmp/main.awk", labels: ["", "awk"] },
  powershell: { image: "mcr.microsoft.com/powershell:7.5-ubuntu-24.04", command: "cat > /tmp/main.ps1 && exec pwsh -NoLogo -NoProfile -NonInteractive -Command '$ErrorActionPreference = \"Stop\"; & /tmp/main.ps1; if (-not $?) { exit 1 }'", labels: ["", "powershell", "pwsh", "ps1"] },
  erlang: { image: "erlang:27-alpine", command: "cat > /tmp/source.erl && if head -c 2 /tmp/source.erl | grep -q '^#!'; then cp /tmp/source.erl /tmp/main.erl; else printf '#!/usr/bin/env escript\\n' > /tmp/main.erl && cat /tmp/source.erl >> /tmp/main.erl; fi && ERL_FLAGS='+S 1:1 +A 1' exec escript /tmp/main.erl", labels: ["", "erlang", "erl"] },
  elixir: { image: "elixir:1.18-alpine", command: "cat > /tmp/main.exs && ERL_FLAGS='+S 1:1 +A 1' exec elixir /tmp/main.exs", labels: ["", "elixir", "ex", "exs"] },
  koka: { image: "sprig-ai-koka:3.2.9", command: "cat > /tmp/main.kk && exec koka --console=raw /tmp/main.kk", labels: ["", "koka", "kk"], timeout: 60000 },
  lua: { image: "sprig-ai-languages:1", command: "cat > /tmp/main.lua && exec lua5.4 /tmp/main.lua", labels: ["", "lua"] },
  sqlite: { image: "sprig-ai-languages:1", command: "cat > /tmp/main.sql && exec sqlite3 -bail :memory: < /tmp/main.sql", labels: ["", "sql", "sqlite", "sqlite3"] },
  pascal: { image: "sprig-ai-languages:1", command: "cat > /tmp/main.pas && fpc -o/tmp/main /tmp/main.pas && exec /tmp/main", labels: ["", "pascal", "pas"], timeout: 60000 },
  cobol: { image: "sprig-ai-languages:1", command: "cat > /tmp/main.cob && cobc -x -o /tmp/main /tmp/main.cob && exec /tmp/main", labels: ["", "cobol", "cob"], timeout: 60000 },
  prolog: { image: "sprig-ai-languages:1", command: "cat > /tmp/main.pl && exec swipl -q -f /tmp/main.pl -t halt", labels: ["", "prolog", "pl"] },
  "common lisp": { image: "sprig-ai-languages:1", command: "cat > /tmp/main.lisp && exec clisp /tmp/main.lisp", labels: ["", "lisp", "common-lisp", "commonlisp"] },
  "emacs lisp": { image: "sprig-ai-languages:1", command: "cat > /tmp/main.el && exec emacs -Q --batch -l /tmp/main.el", labels: ["", "elisp", "emacs-lisp", "lisp"] },
  r: { image: "sprig-ai-languages:1", command: "cat > /tmp/main.R && exec Rscript /tmp/main.R", labels: ["", "r"], timeout: 60000 },
  racket: { image: "sprig-ai-languages:1", command: "cat > /tmp/main.rkt && exec racket /tmp/main.rkt", labels: ["", "racket", "rkt"], timeout: 60000 },
  ocaml: { image: "sprig-ai-languages:1", command: "cat > /tmp/main.ml && exec ocaml /tmp/main.ml", labels: ["", "ocaml", "ml"], timeout: 60000 },
  haskell: { image: "sprig-ai-languages:1", command: "cat > /tmp/main.hs && exec runghc /tmp/main.hs", labels: ["", "haskell", "hs"], timeout: 60000 }
};

function command(args, input, signal, timeout = 20000, waitForAbort = false) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(new CommandError("aborted", "Code test stopped."));
    const env = { ...process.env };
    delete env.DOCKER_CONTEXT;
    delete env.DOCKER_HOST;
    const child = spawn("docker", ["--host", "npipe:////./pipe/dockerDesktopLinuxEngine", ...args], {
      env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"]
    });
    let output = "", timedOut = false, aborted = false, oversized = false, inputError;
    const cancel = () => { aborted = true; if (!waitForAbort) child.kill(); };
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
    if (signal) {
      if (signal.aborted) cancel();
      else signal.addEventListener("abort", cancel, { once: true });
    }
    const collect = chunk => {
      output += chunk.toString();
      if (output.length > 65536) { oversized = true; child.kill(); }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.stdin.on("error", error => { inputError = error; });
    child.once("error", error => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", cancel);
      reject(error);
    });
    child.once("close", code => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", cancel);
      if (timedOut) return reject(new CommandError("timeout", "Code test timed out."));
      if (aborted) return reject(new CommandError("aborted", "Code test stopped."));
      if (oversized) return reject(new CommandError("output-limit", "Code test produced too much output."));
      if (inputError && code === 0) return reject(new Error("Could not send code to the isolated test: " + inputError.message));
      resolve({ code, output });
    });
    child.stdin.end(input);
  });
}

async function testCode(language, text, signal) {
  const environment = environments[language.toLowerCase()];
  if (!environment) return { status: "untested", reason: "unsupported", message: "No isolated test environment is available for " + language + "." };
  const blocks = [...text.matchAll(/```([^\r\n`]*)\r?\n([\s\S]*?)```/g)];
  if (!blocks.length && text.includes("```")) throw new CodeFormatError("The generated code block was incomplete.");
  if (!blocks.length) return { status: "untested", reason: "no-code", message: "No complete code block was available to test." };
  if (blocks.length !== 1 || (text.match(/```/g) || []).length !== 2 ||
      !environment.labels.includes(blocks[0][1].trim().toLowerCase()) || !blocks[0][2].trim()) {
    throw new CodeFormatError("The generated response did not contain one runnable " + language + " program.");
  }
  if (process.platform !== "win32") return { status: "untested", reason: "unavailable", message: "Isolated AI code testing requires Docker Desktop on Windows." };
  const setup = "Start Docker Desktop and run powershell -ExecutionPolicy Bypass -File .\\scripts\\setup-ai-testing.ps1 from the Sprig folder.";
  let image;
  try {
    image = await command(["image", "inspect", "--format", "{{.Id}}", environment.image], undefined, signal);
  } catch (error) {
    if (signal && signal.aborted) throw error;
    if (!(error instanceof CommandError) && error.code !== "ENOENT") throw error;
    return { status: "untested", reason: "unavailable", message: "Could not check the isolated code test environment. " + setup + " " + error.message };
  }
  if (image.code !== 0) return { status: "untested", reason: "unavailable", message: "The isolated code test environment is unavailable. " + setup + " " + stripVTControlCharacters(image.output).trim().slice(0, 500) };
  const name = "sprig-ai-test-" + randomUUID();
  let mayExist = false;
  try {
    mayExist = true;
    let create;
    try {
      create = await command(["create", "--name", name, "--pull", "never", "--network", "none",
        "--read-only", "--tmpfs", "/tmp:rw,exec,nosuid,size=256m,mode=1777", "--user", "65534:65534",
        "--workdir", "/tmp", "--env", "HOME=/tmp", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
        "--pids-limit", "64", "--memory", "512m", "--cpus", "1", "-i", "--entrypoint", "/bin/sh",
        environment.image, "-c", environment.command], undefined, signal, 120000, true);
    } catch (error) {
      if (error instanceof CommandError && error.reason === "timeout") {
        throw new Error("Docker did not finish creating the test container. It may still create " + name + "; check and remove it if needed. The code was withheld.");
      }
      throw error;
    }
    if (create.code !== 0) {
      return { status: "untested", reason: "unavailable", message: "Could not create the isolated code test. " + setup + " " + stripVTControlCharacters(create.output).trim().slice(0, 500) };
    }
    let result;
    try {
      result = await command(["start", "-a", "-i", name], blocks[0][2], signal, environment.timeout);
    } catch (error) {
      if (error instanceof CommandError && error.reason === "timeout") {
        return { status: "failed", diagnostic: "The program timed out in the isolated test. It may require input or take too long." };
      }
      if (error instanceof CommandError && error.reason === "output-limit") {
        return { status: "failed", diagnostic: "The program produced too much output in the isolated test." };
      }
      if (error.code === "ENOENT") return { status: "untested", reason: "unavailable", message: "Docker became unavailable. " + setup };
      throw error;
    }
    if (result.code !== 0) {
      let inspection;
      try { inspection = await command(["inspect", "--format", "{{json .State}}", name], undefined, signal); }
      catch (error) {
        if (signal && signal.aborted) throw error;
        if (!(error instanceof CommandError) && error.code !== "ENOENT") throw error;
        return { status: "untested", reason: "unavailable", message: "Could not inspect the isolated test. " + setup + " " + error.message };
      }
      if (inspection.code !== 0) return { status: "untested", reason: "unavailable", message: "Could not inspect the isolated test. " + setup + " " + stripVTControlCharacters(inspection.output).trim().slice(0, 500) };
      let state;
      try { state = JSON.parse(inspection.output); }
      catch { throw new Error("Docker returned invalid test-container state."); }
      if (!state || typeof state.Status !== "string" || !Number.isInteger(state.ExitCode)) {
        throw new Error("Docker returned invalid test-container state.");
      }
      if (state.Status !== "exited" || state.Error) {
        return { status: "untested", reason: "unavailable", message: "The isolated program did not start or finish. " + setup + " " + stripVTControlCharacters(String(state.Error || "")).slice(0, 500) };
      }
      const diagnostic = stripVTControlCharacters(result.output).slice(-2000);
      return { status: "failed", diagnostic: diagnostic || (state.OOMKilled ? "The program exceeded the test's memory limit." : "Program exited with code " + state.ExitCode + ".") };
    }
    return { status: "passed", message: "Passed a basic isolated run with " + environment.image + " and empty input. The runtime may differ from the selected engine; this does not guarantee correctness or safety." };
  } finally {
    if (mayExist) {
      try {
        const cleanup = await command(["rm", "-f", name], undefined, undefined, 10000);
        if (cleanup.code !== 0 && !/No such container/i.test(cleanup.output)) {
          throw new Error(cleanup.output.trim());
        }
      } catch (error) {
        throw new Error("Could not confirm removal of isolated test container " + name + ": " + error.message);
      }
    }
  }
}

module.exports = { testCode, CodeFormatError };
