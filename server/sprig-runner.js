const http = require("http");
const https = require("https");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFile } = require("child_process");
const readline = require("readline");
const { stripVTControlCharacters } = require("util");
const { generateLocalAi } = require("./local-ai");

const projectRoot = path.resolve(__dirname, "..");
const flixJar = process.env.SPRIG_FLIX_PATH || path.join(projectRoot, "flix.jar");
let PORT = Number(process.env.SPRIG_PORT || 3001);
const openBrowser = process.argv.includes("--open");
const desktop = process.argv.includes("--desktop");
const commandAvailability = new Map();

const commands = {
  bash: ["bash"], dash: ["dash"], c: ["gcc"],
  "c++": ["g++"], python: ["python", "-u"], python2: ["py", "-2", "-u"],
  python3: ["python", "-u"], node: ["node"], javascript: ["node"],
  ruby: ["ruby"], php: ["php"], perl: ["perl"], rscript: ["Rscript"],
  lua: ["lua"], julia: ["julia"], groovy: ["groovy"], dart: ["dart"],
  swift: ["swift"], kotlin: ["kotlinc"], scala: ["scala"], rust: ["rustc"], java: ["java"],
  go: ["go", "run"], pascal: ["fpc"], haskell: ["runghc"], nim: ["nim", "r"],
  crystal: ["crystal", "run"], zig: ["zig", "run"], vlang: ["v", "run"],
  awk: ["awk", "-f"], forth: ["gforth"], powershell: ["powershell", "-File"],
  pwsh: ["pwsh", "-File"], sqlite3: ["sqlite3"], clojure: ["clojure", "-M"],
  emacs: ["emacs", "--batch", "-l"], elixir: ["elixir"], erlang: ["erlc"],
  octave: ["octave", "--quiet"], racket: ["racket"], smalltalk: ["gst"],
  effekt: ["java", "-Xss32m", "-jar", path.join(process.env.APPDATA || "", "npm", "node_modules", "@effekt-lang", "effekt", "bin", "effekt"), "--backend", "js"],
  flix: ["java", "-jar", flixJar]
};

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Content-Type", "application/json");
}

function available(command) {
  const checker = process.platform === "win32" ? "where" : "which";
  return spawn(checker, [command], { shell: false, windowsHide: true });
}

async function commandAvailable(command) {
  if (commandAvailability.has(command)) return commandAvailability.get(command);
  return new Promise(resolve => {
    const child = available(command);
    child.on("error", () => { commandAvailability.set(command, false); resolve(false); });
    child.on("close", code => { const ok = code === 0; commandAvailability.set(command, ok); resolve(ok); });
  });
}

async function localCommand(language) {
  if (process.platform === "win32" && language === "scala") {
    return await commandAvailable("scala.exe")
      ? ["scala.exe"]
      : ["scala-cli.exe", "run", "--server=false"];
  }
  return commands[language];
}

async function localRuntimeAvailable(language) {
  const spec = await localCommand(language);
  if (!spec || !(await commandAvailable(spec[0]))) return false;
  if (spec.some(arg => path.isAbsolute(arg) && !fs.existsSync(arg))) return false;
  const extra = { java: "javac", erlang: "erl", effekt: "node" }[language];
  return !extra || await commandAvailable(extra);
}

async function promptDownload(target) {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(`Runtime '${target}' is not installed. Install with winget or scoop? (winget/scoop/n) `, answer => {
      rl.close();
      const choice = answer.trim().toLowerCase();
      resolve(choice === "winget" || choice === "w" ? "winget" :
        choice === "scoop" || choice === "s" ? "scoop" : false);
    });
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const client = url.startsWith("https") ? https : http;
    client.get(url, response => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on("finish", () => {
        file.close();
        resolve(true);
      });
    }).on("error", err => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function installLanguage(payload, language, manager) {
  const spec = commands[language];
  if (!spec) return false;

  const log = msg => {
    if (payload.onEvent) payload.onEvent({ stdout: msg + "\n" });
    console.log(msg);
  };

  log(`Installing ${language}...`);

  if (language === "flix") {
    const jarPath = flixJar;
    const url = "https://github.com/flix/flix/releases/latest/download/flix.jar";
    try {
      return await downloadFile(url, jarPath);
    } catch (e) {
      log(`Failed to download Flix: ${e.message}`);
      return false;
    }
  }

  if (language === "effekt") {
    return new Promise(resolve => {
      const child = spawn("npm", ["install", "-g", "@effekt-lang/effekt"], { shell: true });
      child.stdout.on("data", b => payload.onEvent?.({ stdout: b.toString() }));
      child.stderr.on("data", b => payload.onEvent?.({ stderr: b.toString() }));
      child.on("close", code => resolve(code === 0));
    });
  }

  if (process.platform === "win32") {
    const wingetIds = {
      python: "Python.Python.3", python3: "Python.Python.3",
      node: "OpenJS.NodeJS", javascript: "OpenJS.NodeJS",
      ruby: "RubyInstallerTeam.Ruby.3.1", go: "Google.Go",
      rust: "Rustlang.Rust.MSVC", java: "Eclipse.Adoptium.Temurin.21.JDK",
      php: "PHP.PHP", perl: "StrawberryPerl.StrawberryPerl",
      lua: "Lua.Lua", julia: "Julia.Julia", dart: "Dart.Dart",
      swift: "Swift.Swift", zig: "zig.zig"
    };
    const id = wingetIds[language] || spec[0];
    if (manager === "scoop") {
      const scoopIds = {
        python: "python", python3: "python",
        node: "nodejs-lts", javascript: "nodejs-lts",
        ruby: "ruby", go: "go", rust: "rust",
        java: "openjdk21", php: "php", perl: "perl",
        lua: "lua", julia: "julia", dart: "dart",
        swift: "swift", zig: "zig"
      };
      const scoopId = scoopIds[language] || id;
      return new Promise(resolve => {
        const child = spawn("scoop", ["install", scoopId], { shell: true });
        child.stdout.on("data", b => payload.onEvent?.({ stdout: b.toString() }));
        child.stderr.on("data", b => payload.onEvent?.({ stderr: b.toString() }));
        child.on("close", code => resolve(code === 0));
      });
    }
    return new Promise(resolve => {
      const child = spawn("winget", ["install", "-e", "--id", id, "--silent", "--accept-package-agreements", "--accept-source-agreements"], { shell: true });
      child.stdout.on("data", b => payload.onEvent?.({ stdout: b.toString() }));
      child.stderr.on("data", b => payload.onEvent?.({ stderr: b.toString() }));
      child.on("close", code => resolve(code === 0));
    });
  }
  return false;
}

function extensionFor(language) {
  const map = {
    bash:"sh", dash:"sh", c:"c", "c++":"cpp", python:"py", python2:"py",
    python3:"py", node:"js", javascript:"js", ruby:"rb", php:"php", perl:"pl",
    rscript:"R", lua:"lua", julia:"jl", groovy:"groovy", dart:"dart",
    swift:"swift", kotlin:"kt", scala:"scala", rust:"rs", go:"go",
    pascal:"pas", haskell:"hs", nim:"nim", crystal:"cr", zig:"zig", java:"java",
    vlang:"v", awk:"awk", forth:"fs", powershell:"ps1", pwsh:"ps1",
    sqlite3:"sql", clojure:"clj", emacs:"el", elixir:"exs", erlang:"erl",
    octave:"m", racket:"rkt", smalltalk:"st", effekt:"effekt", flix:"flix"
  };
  return map[language] || "txt";
}

const PISTON_URL = process.env.PISTON_URL || "http://127.0.0.1:2000/api/v2/execute";
const sessions = new Map();

function createSession(id) {
  const session = { id, child: null, queue: [], closed: false };
  sessions.set(id, session);
  return session;
}

function flushSession(session) {
  if (session.compiling) return;
  const child = session.child;
  if (session.pty && child) {
    while (session.queue.length) child.write(session.queue.shift().replace(/\r?\n/g, "\r"));
    if (session.closed) { child.write("\x1a\r"); session.closed = false; }
    return;
  }
  if (!child || !child.stdin || !child.stdin.writable) return;
  while (session.queue.length) {
    const data = session.queue.shift();
    child.stdin.write(data);
  }
  if (session.closed) child.stdin.end();
}

function pushStdin(id, data, close) {
  const session = sessions.get(id);
  if (!session) return false;
  if (session.onInputOnce) {
    const cb = session.onInputOnce;
    delete session.onInputOnce;
    cb(data);
    return true;
  }
  if (data !== undefined && data !== null) session.queue.push(data);
  if (close) session.closed = true;
  flushSession(session);
  return true;
}

async function proxyPiston(payload) {
  const body = JSON.stringify({
    language: payload.language,
    version: payload.version || "*",
    files: payload.files || [],
    stdin: payload.stdin || ""
  });
  let response;
  try {
    response = await fetch(PISTON_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body });
  } catch (error) {
    const err = new Error("Piston is not running at " + PISTON_URL + ". Start the Piston container, or install this language locally.");
    err.status = 502;
    throw err;
  }
  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch (error) { parsed = { message: text.slice(0, 500) }; }
  if (!response.ok || (parsed.message && !parsed.run && !parsed.compile)) {
    const err = new Error(parsed.message || ("Piston request failed (HTTP " + response.status + ")"));
    err.status = response.status;
    throw err;
  }
  return parsed;
}

function createLocalPlan(language, spec, source) {
  const executable = spec[0];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sprig-"));
  const erlangModule = language === "erlang" && source.match(/^\s*-module\s*\(\s*([a-z][a-zA-Z0-9_@]*)\s*\)\s*\./m);
  const moduleName = erlangModule ? erlangModule[1] : "main";
  const fileName = language === "java" ? "Main.java" : language === "erlang" ? moduleName + ".erl" : "main." + extensionFor(language);
  const file = path.join(dir, fileName);
  fs.writeFileSync(file, source, "utf8");

  let args = spec.slice(1).concat([file]);
  let compiledArgs = null;
  let compiler = executable;
  let runCompiledOutput = null;

  if (language === "sqlite3") {
    args = ["-batch", "-bail", "-init", file, ":memory:", ".exit"];
  } else if (language === "c" || language === "c++") {
    const output = path.join(dir, process.platform === "win32" ? "main.exe" : "main");
    compiledArgs = [file, "-o", output];
  } else if (language === "rust") {
    const output = path.join(dir, process.platform === "win32" ? "main.exe" : "main");
    compiledArgs = [file, "-o", output];
  } else if (language === "pascal") {
    const output = path.join(dir, "main");
    compiledArgs = ["-o" + output, file];
  } else if (language === "java") {
    compiler = "javac";
    compiledArgs = [file];
    runCompiledOutput = ["java", ["Main"]];
  } else if (language === "effekt") {
    compiler = executable;
    compiledArgs = spec.slice(1).concat(["-c", "--out", dir, file]);
    runCompiledOutput = ["node", ["-e", "if(process.stdout._handle)process.stdout._handle.setBlocking(true); require('./main.js').main()"]];
  } else if (language === "erlang") {
    compiler = "erlc";
    compiledArgs = [file];
    runCompiledOutput = ["erl", ["-noshell", "-pa", dir, "-s", moduleName, "main", "-s", "init", "stop"]];
  }
  return { dir, executable, args, compiledArgs, compiler, runCompiledOutput };
}

async function execute(payload) {
  if (payload.language === "__windows_terminal__") {
    if (!payload.interactive || process.platform !== "win32") {
      throw new Error("Windows Terminal is available only in the interactive Windows desktop app.");
    }
    return new Promise(resolve => {
      const pty = require("node-pty").spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NoExit"], {
        name: "xterm", cols: 120, rows: 30,
        cwd: payload.cwd || process.cwd(), env: process.env
      });
      const session = sessions.get(payload.session);
      if (!session) return resolve({ run: { stdout: "", stderr: "Terminal session was closed.", code: 1 } });
      session.child = pty; session.pty = true;
      payload.onEvent?.({ pty: true });
      pty.onData(data => payload.onEvent?.({
        stdout: stripVTControlCharacters(data).replace(/\r\n?/g, "\n")
      }));
      pty.onExit(({ exitCode }) => {
        sessions.delete(payload.session);
        resolve({ run: { stdout: "", stderr: "", code: exitCode || 0 } });
      });
      if (payload.stdin) session.queue.push(payload.stdin);
      if (payload.closeStdin) session.closed = true;
      flushSession(session);
    });
  }
  const language = payload.language;
  const spec = await localCommand(language);
  if (!spec) return proxyPiston(payload);

  const executable = spec[0];
  let missing = !(await commandAvailable(executable));
  let missingTarget = executable;
  for (const arg of spec) {
    if (path.isAbsolute(arg) && !fs.existsSync(arg)) {
      missing = true;
      missingTarget = path.basename(arg);
      break;
    }
  }
  if (missing) {
    if (payload.allowInstall === false) {
      throw new Error("Runtime '" + missingTarget + "' is not installed or is not on PATH.");
    }
    const msg = `Runtime '${missingTarget}' is not installed. Install with winget or scoop? (winget/scoop/n) `;
    let manager = false;
    if (payload.interactive) {
      if (payload.onEvent) payload.onEvent({ stdout: msg });
      const answer = await new Promise(resolve => {
        const session = sessions.get(payload.session);
        session.onInputOnce = data => resolve(data.trim());
      });
      const choice = answer?.toLowerCase();
      manager = choice === "winget" || choice === "w" ? "winget" :
        choice === "scoop" || choice === "s" ? "scoop" : false;
    } else {
      manager = await promptDownload(missingTarget);
    }
    if (manager) {
      if (await installLanguage(payload, language, manager)) {
        commandAvailability.delete(executable);
        if (!(await commandAvailable(executable)) && !path.isAbsolute(missingTarget)) {
          throw new Error("Installed '" + missingTarget + "' but it is still not on PATH. You may need to restart the runner.");
        }
      } else {
        throw new Error("Failed to install '" + missingTarget + "' automatically.");
      }
    } else {
      throw new Error("Runtime '" + executable + "' is not installed or is not on PATH.");
    }
  }
  const { dir, args, compiledArgs, compiler, runCompiledOutput } =
    createLocalPlan(language, spec, payload.files?.[0]?.content || "");

  try { return await new Promise(resolve => {
    const run = (cmd, runArgs) => {
      if (payload.session && sessions.has(payload.session) && sessions.get(payload.session).child) {
        return;
      }
      if (process.platform === "win32" && (language === "powershell" || language === "pwsh") &&
          payload.interactive && !payload.closeStdin && payload.session && sessions.has(payload.session)) {
        let terminal;
        try {
          terminal = require("node-pty").spawn(cmd + ".exe", runArgs, {
            name: "xterm", cols: 120, rows: 30, cwd: dir, env: process.env
          });
        } catch (error) {
          resolve({ run: { stdout: "", stderr: "Could not start the interactive terminal: " + error.message +
            ". Run npm install in the Sprig folder and restart the runner.", code: 1, signal: null } });
          return;
        }
        const session = sessions.get(payload.session);
        session.child = terminal; session.pty = true;
        if (payload.onEvent) payload.onEvent({ pty: true });
        let stdout = "", timedOut = false;
        const timeout = setTimeout(() => {
          timedOut = true;
          if (payload.onEvent) payload.onEvent({ stderr: "\nStopped after 120 seconds (time limit)" });
          terminal.kill();
        }, 120000);
        terminal.onData(data => {
          const text = stripVTControlCharacters(data).replace(/\r(?!\n)/g, "");
          stdout += text;
          if (text && payload.onEvent) payload.onEvent({ stdout: text });
        });
        terminal.onExit(({ exitCode }) => {
          clearTimeout(timeout);
          sessions.delete(payload.session);
          resolve({ run: { stdout, stderr: timedOut ? "Stopped after 120 seconds (time limit)" : "",
            code: timedOut ? 1 : exitCode, signal: null } });
        });
        flushSession(session);
        return;
      }
      const child = spawn(cmd, runArgs, {
        cwd: dir, env: process.env, shell: false, windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"]
      });
      let stdout = "", stderr = "", timedOut = false;
      const limit = payload.interactive && !payload.closeStdin ? 120000 : 30000;
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill();
        const note = "\nStopped after " + (limit / 1000) + " seconds (time limit)";
        stderr += note;
        if (payload.onEvent) payload.onEvent({ stderr: note });
      }, limit);
      child.stdin.on("error", () => {});
      if (payload.interactive && payload.session && sessions.has(payload.session)) {
        const session = sessions.get(payload.session);
        session.child = child;
        flushSession(session);
      } else {
        child.stdin.end(payload.stdin || "");
      }
      const finish = (code, signal, error) => {
        clearTimeout(timeout);
        if (payload.session) sessions.delete(payload.session);
        if (language === "effekt") {
          stderr = stderr.split(/\r?\n/)
            .filter(line => line && !line.includes("terminally deprecated") && !line.includes("sun.misc.Unsafe") && !line.includes("Please consider reporting") && !line.includes("illegal reflective access"))
            .join("\n");
        }
        if (language === "clojure") {
          stderr = stderr.split(/\r?\n/)
            .filter(line => line && !line.includes("Implicit use of clojure.main") && !line.includes("deprecated, use -M"))
            .join("\n");
        }
        if (error) stderr += error;
        resolve({ run: { stdout, stderr, code: timedOut ? 124 : (Number.isInteger(code) ? code : 1), signal: signal || null } });
      };
      child.stdout.on("data", b => { stdout += b; if (payload.onEvent) payload.onEvent({ stdout: b.toString() }); });
      child.stderr.on("data", b => { stderr += b; if (payload.onEvent) payload.onEvent({ stderr: b.toString() }); });
      child.once("error", e => finish(1, null, e.message));
      child.once("close", (code, signal) => finish(code, signal));
    };

    if (compiledArgs) {
      const child = spawn(compiler, compiledArgs, { cwd: dir, env: process.env, shell: false, windowsHide: true });
      const session = payload.session && sessions.get(payload.session);
      if (session) { session.child = child; session.compiling = true; }
      let stdout = "", stderr = "", startupError, timedOut = false;
      const timeout = setTimeout(() => { timedOut = true; child.kill(); }, 120000);
      child.stdout.on("data", b => stdout += b);
      child.stderr.on("data", b => stderr += b);
      child.once("error", error => { startupError = error; });
      child.once("close", (code, signal) => {
        clearTimeout(timeout);
        if (session) { session.child = null; session.compiling = false; }
        if (startupError) stderr += startupError.message;
        if (timedOut) stderr += "\nCompilation stopped after 120 seconds (time limit).";
        if (code !== 0 || startupError || timedOut) return resolve({ compile: {
          stdout, stderr, code: timedOut ? 124 : (Number.isInteger(code) && code !== 0 ? code : 1),
          signal: signal || null, output: stdout + stderr
        }, run: null });
        if (runCompiledOutput) return run(runCompiledOutput[0], runCompiledOutput[1]);
        const output = path.join(dir, process.platform === "win32" ? "main.exe" : "main");
        run(output, []);
      });
    } else {
      run(executable, args);
    }
  }); } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); }
    catch (error) { throw new Error("Could not remove temporary run files: " + error.message); }
  }
}

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.url === "/api/v2/ai/generate") {
    const host = (req.headers.host || "").toLowerCase();
    const origin = req.headers.origin;
    const validHost = host === "127.0.0.1:" + PORT || host === "localhost:" + PORT;
    res.removeHeader("Access-Control-Allow-Origin");
    if (!validHost || (origin && origin !== "http://" + host) || (req.method === "POST" && !origin)) {
      res.statusCode = 403;
      return res.end(JSON.stringify({ message: "Local AI is only available to the local Sprig page." }));
    }
    if (req.method !== "POST") {
      res.statusCode = 405;
      return res.end(JSON.stringify({ message: "Use POST for local AI requests." }));
    }
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || "")) {
      res.statusCode = 415;
      return res.end(JSON.stringify({ message: "Local AI requests must use JSON." }));
    }
    const chunks = [];
    let size = 0, rejected = false;
    req.on("data", chunk => {
      size += chunk.length;
      if (size > 512 * 1024) {
        if (!rejected) {
          rejected = true;
          res.statusCode = 413;
          res.end(JSON.stringify({ message: "Local AI request is too large." }));
        }
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", async () => {
      if (rejected) return;
      let payload;
      try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch (error) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ message: "Invalid JSON." }));
      }
      const controller = new AbortController();
      res.on("close", () => { if (!res.writableEnded) controller.abort(); });
      const wantsStream = (req.headers.accept || "").includes("application/x-ndjson");
      const sendEvent = event => {
        if (res.destroyed || res.writableEnded) return;
        if (!res.headersSent) {
          res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
        }
        res.write(JSON.stringify(event) + "\n");
      };
      try {
        const stream = wantsStream ? {
          progress: (message, completedTests, stage) => sendEvent({ type: "progress", message, ...(completedTests === undefined ? {} : { completedTests }), ...(stage === undefined ? {} : { stage }) }),
          delta: text => sendEvent({ type: "delta", text })
        } : undefined;
        const result = await generateLocalAi(payload, controller.signal, stream);
        if (!res.destroyed && !res.writableEnded) {
          if (wantsStream) { sendEvent({ type: "done", text: result.text, verification: result.verification }); res.end(); }
          else res.end(JSON.stringify(result));
        }
      } catch (error) {
        if (!res.destroyed && !res.writableEnded) {
          if (res.headersSent) { sendEvent({ type: "error", message: error.message }); res.end(); }
          else { res.statusCode = error.status || 500; res.end(JSON.stringify({ message: error.message })); }
        }
      }
    });
    return;
  }
  if (req.method === "OPTIONS") return res.end("{}");
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(fs.readFileSync(path.join(projectRoot, "index.html")));
  }
  if (req.method === "GET" && req.url.startsWith("/vendor/")) {
    const name = path.basename(req.url);
    const file = path.join(projectRoot, "sprig-vendor", name);
    if (!fs.existsSync(file)) {
      res.statusCode = 404;
      return res.end(JSON.stringify({ message: "Vendor file not found" }));
    }
    res.setHeader("Content-Type", name.endsWith(".js") ? "application/javascript" : "application/octet-stream");
    return res.end(fs.readFileSync(file));
  }
  if (req.method === "GET" && req.url.startsWith("/api/v2/runtimes")) {
    const runtimes = Object.keys(commands).map(language => ({
      language, version: "local", aliases: [language]
    }));
    return res.end(JSON.stringify(runtimes));
  }
  if (req.method === "GET" && req.url.startsWith("/api/v2/available-runtimes")) {
    commandAvailability.clear();
    const languages = Object.keys(commands);
    const availability = await Promise.all(languages.map(localRuntimeAvailable));
    return res.end(JSON.stringify(languages.filter((language, index) => availability[index])
      .map(language => ({ language, version: "local", aliases: [language] }))));
  }
  if (req.method === "GET" && req.url.startsWith("/api/v2/piston/runtimes")) {
    const runtimesUrl = PISTON_URL.replace(/execute\/?$/, "runtimes");
    try {
      const response = await fetch(runtimesUrl);
      res.statusCode = response.status;
      return res.end(await response.text());
    } catch (error) {
      res.statusCode = 502;
      return res.end(JSON.stringify({ message: "Could not reach Piston at " + runtimesUrl + ": " + error.message }));
    }
  }
  if (req.method === "GET" && req.url.startsWith("/api/v2/wandbox/runtimes")) {
    try {
      const { listRuntimes } = await import("../functions/_lib/wandbox.mjs");
      return res.end(JSON.stringify(await listRuntimes()));
    } catch (error) {
      res.statusCode = error.status || 502;
      return res.end(JSON.stringify({ message: error.message }));
    }
  }
  if (req.method === "GET" && req.url.startsWith("/api/v2/tio/runtimes")) {
    try {
      const { listRuntimes } = await import("../functions/_lib/tio.mjs");
      return res.end(JSON.stringify(await listRuntimes()));
    } catch (error) {
      res.statusCode = error.status || 502;
      return res.end(JSON.stringify({ message: error.message }));
    }
  }
  if (req.method === "POST" && req.url.startsWith("/api/v2/stdin")) {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const payload = JSON.parse(body || "{}");
        const ok = pushStdin(payload.session, payload.data || "", !!payload.close);
        res.end(JSON.stringify({ ok }));
      } catch (error) {
        res.statusCode = 400;
        res.end(JSON.stringify({ message: error.message }));
      }
    });
    return;
  }
  const pistonProxy = req.method === "POST" && req.url.startsWith("/api/v2/piston/execute");
  const wandboxProxy = req.method === "POST" && req.url.startsWith("/api/v2/wandbox/execute");
  const tioProxy = req.method === "POST" && req.url.startsWith("/api/v2/tio/execute");
  if (req.method !== "POST" || (!req.url.startsWith("/api/v2/execute") && !pistonProxy && !wandboxProxy && !tioProxy)) {
    res.statusCode = 404;
    return res.end(JSON.stringify({ message: "Not found" }));
  }

  let body = "";
  req.on("data", chunk => body += chunk);
  req.on("end", async () => {
    let payload;
    try { payload = JSON.parse(body || "{}"); }
    catch (error) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ message: "Invalid JSON" }));
    }
    if (pistonProxy) {
      try {
        const result = await proxyPiston(payload);
        res.end(JSON.stringify(result));
      } catch (error) {
        res.statusCode = error.status || 502;
        res.end(JSON.stringify({ message: error.message }));
      }
      return;
    }
    if (wandboxProxy) {
      try {
        const { execute: executeWandbox } = await import("../functions/_lib/wandbox.mjs");
        const result = await executeWandbox(payload);
        res.end(JSON.stringify(result));
      } catch (error) {
        res.statusCode = error.status || 502;
        res.end(JSON.stringify({ message: error.message }));
      }
      return;
    }
    if (tioProxy) {
      try {
        const { execute: executeTio } = await import("../functions/_lib/tio.mjs");
        const result = await executeTio(payload);
        res.end(JSON.stringify(result));
      } catch (error) {
        res.statusCode = error.status || 502;
        res.end(JSON.stringify({ message: error.message }));
      }
      return;
    }
    if (!payload.interactive) {
      try {
        const result = await execute(payload);
        res.end(JSON.stringify(result));
      } catch (error) {
        res.statusCode = error.status || 400;
        res.end(JSON.stringify({ message: error.message }));
      }
      return;
    }

    const id = payload.session || Math.random().toString(36).slice(2);
    const session = sessions.get(id) || createSession(id);
    payload.session = id;
    if (payload.stdin) session.queue.push(payload.stdin);
    if (payload.closeStdin) session.closed = true;
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    let streamed = false;
    payload.onEvent = event => { streamed = true; if (!res.writableEnded) res.write(JSON.stringify(event) + "\n"); };
    res.on("close", () => { if (!res.writableEnded && session.child) session.child.kill(); });
    try {
      const result = await execute(payload);
      if (result.compile) res.write(JSON.stringify({ compile: result.compile }) + "\n");
      if (result.run && !streamed) {
        if (result.run.stdout) res.write(JSON.stringify({ stdout: result.run.stdout }) + "\n");
        if (result.run.stderr) res.write(JSON.stringify({ stderr: result.run.stderr }) + "\n");
      }
      const code = result.run ? result.run.code : (result.compile ? result.compile.code : 1);
      res.write(JSON.stringify({ exit: code || 0 }) + "\n");
      res.end();
    } catch (error) {
      if (!res.headersSent) res.statusCode = error.status || 400;
      const line = JSON.stringify({ message: error.message }) + "\n";
      if (res.headersSent) res.end(line);
      else res.end(JSON.stringify({ message: error.message }));
    } finally {
      sessions.delete(id);
    }
  });
});

let nextPort = PORT + 1, remainingPorts = openBrowser || desktop ? 20 : 0;
let retryOnEphemeralPort = openBrowser || desktop;
server.on("error", error => {
  if ((openBrowser || desktop) && ["EADDRINUSE", "EACCES"].includes(error.code) && (remainingPorts > 0 || retryOnEphemeralPort)) {
    if (remainingPorts === 20) console.log("Port " + PORT + " is already in use. Starting a separate runner; save any work in the existing page before switching.");
    if (remainingPorts > 0 && nextPort <= 65535) {
      remainingPorts--;
      server.listen(nextPort++, "127.0.0.1");
    } else {
      remainingPorts = 0;
      retryOnEphemeralPort = false;
      server.listen(0, "127.0.0.1");
    }
    return;
  }
  console.error("Could not start the Sprig local runner: " + error.message);
  process.exitCode = 1;
});
server.on("listening", () => {
  PORT = server.address().port;
  const url = "http://127.0.0.1:" + PORT + "/";
  console.log("Sprig local runner listening on " + url);
  if (openBrowser) {
    execFile("rundll32.exe", ["url.dll,FileProtocolHandler", url], error => {
      if (error) console.error("Could not open the browser: " + error.message + ". Open " + url + " manually.");
    });
  }
});
server.listen(PORT, "127.0.0.1");
