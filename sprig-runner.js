const http = require("http");
const https = require("https");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const readline = require("readline");

const PORT = Number(process.env.SPRIG_PORT || 3001);
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
  octave: ["octave", "--quiet", "--eval"], racket: ["racket"], smalltalk: ["gst"],
  effekt: ["java", "-Xss32m", "-jar", path.join(process.env.APPDATA || "", "npm", "node_modules", "@effekt-lang", "effekt", "bin", "effekt"), "--backend", "js"],
  flix: ["java", "-jar", path.join(__dirname, "flix.jar")]
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

async function promptDownload(target) {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(`Runtime '${target}' is not installed. Would you like to download it? (y/n) `, answer => {
      rl.close();
      resolve(answer.toLowerCase().startsWith("y"));
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

async function installLanguage(payload, language) {
  const spec = commands[language];
  if (!spec) return false;

  const log = msg => {
    if (payload.onEvent) payload.onEvent({ stdout: msg + "\n" });
    console.log(msg);
  };

  log(`Installing ${language}...`);

  if (language === "flix") {
    const jarPath = path.join(__dirname, "flix.jar");
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
  const child = session.child;
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

async function execute(payload) {
  const language = payload.language;
  const spec = commands[language];
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
    const msg = `Runtime '${missingTarget}' is not installed. Would you like to download it? (y/n) `;
    let confirmed = false;
    if (payload.interactive) {
      if (payload.onEvent) payload.onEvent({ stdout: msg });
      const answer = await new Promise(resolve => {
        const id = payload.session;
        const session = sessions.get(id);
        const originalPush = pushStdin;
        // Temporary override to capture the next input for this session
        const tempSessions = sessions;
        const tempId = id;
        const checkInput = (sid, data) => {
          if (sid === tempId) {
            resolve(data.trim());
            return true;
          }
          return false;
        };
        // We need a way to intercept the next stdin for this session
        // Let's use a one-time listener pattern
        session.onInputOnce = (data) => {
          resolve(data.trim());
        };
      });
      confirmed = answer?.toLowerCase().startsWith("y");
    } else {
      confirmed = await promptDownload(missingTarget);
    }

    if (confirmed) {
      if (await installLanguage(payload, language)) {
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

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sprig-"));
  const fileName = language === "java" ? "Main.java" : "main." + extensionFor(language);
  const file = path.join(dir, fileName);
  fs.writeFileSync(file, payload.files?.[0]?.content || "", "utf8");

  let args = spec.slice(1).concat([file]);
  let compiledArgs = null;
  let compiler = executable;
  let runCompiledOutput = null;

  if (language === "c" || language === "c++") {
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
    runCompiledOutput = ["erl", ["-noshell", "-pa", dir, "-s", "main", "main", "-s", "init", "stop"]];
  }

  return new Promise(resolve => {
    const run = (cmd, runArgs) => {
      if (payload.session && sessions.has(payload.session) && sessions.get(payload.session).child) {
        return;
      }
      const child = spawn(cmd, runArgs, {
        cwd: dir, env: process.env, shell: false, windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"]
      });
      let stdout = "", stderr = "";
      const limit = payload.interactive && !payload.closeStdin ? 120000 : 30000;
      const timeout = setTimeout(() => {
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
      const finish = (code, error) => {
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
        resolve({ run: { stdout, stderr, code: code || 0, signal: null } });
      };
      child.stdout.on("data", b => { stdout += b; if (payload.onEvent) payload.onEvent({ stdout: b.toString() }); });
      child.stderr.on("data", b => { stderr += b; if (payload.onEvent) payload.onEvent({ stderr: b.toString() }); });
      child.on("error", e => finish(1, e.message));
      child.on("close", code => finish(code || 0));
    };

    if (compiledArgs) {
      const child = spawn(compiler, compiledArgs, { cwd: dir, env: process.env, shell: false, windowsHide: true });
      let stdout = "", stderr = "";
      child.stdout.on("data", b => stdout += b);
      child.stderr.on("data", b => stderr += b);
      child.on("close", code => {
        if (code !== 0) return resolve({ compile: { stdout, stderr, code, output: stdout + stderr }, run: null });
        if (runCompiledOutput) return run(runCompiledOutput[0], runCompiledOutput[1]);
        const output = path.join(dir, process.platform === "win32" ? "main.exe" : "main");
        run(output, []);
      });
    } else {
      run(executable, args);
    }
  });
}

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.end("{}");
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(fs.readFileSync(path.join(__dirname, "index.html")));
  }
  if (req.method === "GET" && req.url.startsWith("/vendor/")) {
    const name = path.basename(req.url);
    const file = path.join(__dirname, "sprig-vendor", name);
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
  if (req.method !== "POST" || (!req.url.startsWith("/api/v2/execute") && !pistonProxy)) {
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

server.listen(PORT, "127.0.0.1", () => {
  console.log("Sprig local runner listening on http://127.0.0.1:" + PORT);
});
