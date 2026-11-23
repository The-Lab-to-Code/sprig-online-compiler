const API_BASE = "https://wandbox.org/api";
const MAX_SOURCE_BYTES = 128 * 1024;
const MAX_STDIN_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = 64 * 1024;

function lazyKStarter() {
  // Encode the output as a Lazy K stream of Church numerals.
  const compose = "``s`ksk";
  const successor = number => "``s" + compose + number;
  const two = successor(successor("`ki"));
  const numeral = number => number === 0 ? "`ki" : number % 2
    ? successor(numeral(number - 1))
    : "``" + compose + two + numeral(number / 2);
  const bytes = Array.from("Hello, World!\n", character => character.charCodeAt(0)).concat(256);
  const output = bytes.reduceRight((tail, byte) => "``s``si`k" + numeral(byte) + "`k" + tail, "i");
  return "`k" + output;
}

const LANGUAGE_META = {
  "C": { runtime: "c", extension: "c", name: "C" },
  "C++": { runtime: "c++", extension: "cpp", name: "C++" },
  "C#": { runtime: "csharp", extension: "cs", name: "C#" },
  "Erlang": { runtime: "erlang", extension: "erl", name: "Erlang" },
  "Elixir": { runtime: "elixir", extension: "exs", name: "Elixir" },
  "Haskell": { runtime: "haskell", extension: "hs", name: "Haskell" },
  "D": { runtime: "d", extension: "d", name: "D" },
  "Java": { runtime: "java", extension: "java", name: "Java" },
  "Rust": { runtime: "rust", extension: "rs", name: "Rust" },
  "Python": { runtime: "python", extension: "py", name: "Python" },
  "Ruby": { runtime: "ruby", extension: "rb", name: "Ruby" },
  "Scala": { runtime: "scala", extension: "scala", name: "Scala" },
  "Groovy": { runtime: "groovy", extension: "groovy", name: "Groovy" },
  "JavaScript": { runtime: "node", extension: "js", name: "JavaScript" },
  "Swift": { runtime: "swift", extension: "swift", name: "Swift" },
  "Perl": { runtime: "perl", extension: "pl", name: "Perl" },
  "PHP": { runtime: "php", extension: "php", name: "PHP" },
  "Lua": { runtime: "lua", extension: "lua", name: "Lua" },
  "SQL": { runtime: "sqlite3", extension: "sql", name: "SQLite" },
  "Pascal": { runtime: "pascal", extension: "pas", name: "Pascal" },
  "Lisp": { runtime: "lisp", extension: "lisp", name: "Lisp" },
  "Lazy K": { runtime: "lazyk", extension: "lazyk", name: "Lazy K", starter: lazyKStarter() },
  "Vim script": { runtime: "vimscript", extension: "vim", name: "Vim script", starter: 'echo "Hello, World!"' },
  "OCaml": { runtime: "ocaml", extension: "ml", name: "OCaml" },
  "Go": { runtime: "go", extension: "go", name: "Go" },
  "Bash script": { runtime: "bash", extension: "sh", name: "Bash" },
  "Pony": { runtime: "ponylang", extension: "pony", name: "Pony" },
  "Crystal": { runtime: "crystal", extension: "cr", name: "Crystal" },
  "Nim": { runtime: "nim", extension: "nim", name: "Nim" },
  "OpenSSL": { runtime: "openssl", extension: "cnf", name: "OpenSSL",
    starter: "printf 'Hello, World!' | openssl base64 | openssl base64 -d\necho" },
  "R": { runtime: "rscript", extension: "r", name: "R" },
  "TypeScript": { runtime: "typescript", extension: "ts", name: "TypeScript" },
  "Julia": { runtime: "julia", extension: "jl", name: "Julia" },
  "Zig": { runtime: "zig", extension: "zig", name: "Zig" }
};

const RUNTIME_LANGUAGE = {
  c: "C",
  "c++": "C++",
  cpp: "C++",
  csharp: "C#",
  "csharp.net": "C#",
  erlang: "Erlang",
  elixir: "Elixir",
  haskell: "Haskell",
  d: "D",
  java: "Java",
  rust: "Rust",
  python: "Python",
  python3: "Python",
  cpy: "Python",
  python2: "Python 2",
  ruby: "Ruby",
  scala: "Scala",
  groovy: "Groovy",
  node: "JavaScript",
  javascript: "JavaScript",
  swift: "Swift",
  perl: "Perl",
  php: "PHP",
  lua: "Lua",
  sqlite3: "SQL",
  sql: "SQL",
  pascal: "Pascal",
  lisp: "Lisp",
  lazyk: "Lazy K",
  vimscript: "Vim script",
  ocaml: "OCaml",
  go: "Go",
  bash: "Bash script",
  dash: "Bash script",
  ponylang: "Pony",
  crystal: "Crystal",
  nim: "Nim",
  openssl: "OpenSSL",
  r: "R",
  rscript: "R",
  typescript: "TypeScript",
  julia: "Julia",
  zig: "Zig"
};

export class WandboxError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = "WandboxError";
    this.status = status;
  }
}

function compilerMeta(entry) {
  if (entry.language === "Python" && /cpython-2(?:\.|$)/i.test(entry.name)) {
    return { runtime: "python2", extension: "py", name: "Python 2" };
  }
  return LANGUAGE_META[entry.language];
}

async function getCompilerList(fetchImpl, signal) {
  let response;
  try {
    response = await fetchImpl(`${API_BASE}/list.json`, { signal });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new WandboxError("Could not reach Wandbox compiler list.");
  }
  if (!response.ok) throw new WandboxError(`Wandbox compiler list failed (HTTP ${response.status}).`);
  let compilers;
  try {
    compilers = await response.json();
  } catch (error) {
    throw new WandboxError("Wandbox returned an invalid compiler list.");
  }
  if (!Array.isArray(compilers)) throw new WandboxError("Wandbox returned an invalid compiler list.");
  return compilers.filter(entry => entry && typeof entry.name === "string" && typeof entry.language === "string");
}

export async function listRuntimes(fetchImpl = fetch) {
  const compilers = await getCompilerList(fetchImpl);
  const groups = new Map();
  compilers.forEach(entry => {
    if (entry.language === "CPP") return;
    const meta = compilerMeta(entry);
    if (!meta) return;
    if (!groups.has(meta.runtime)) groups.set(meta.runtime, { meta, compilers: [] });
    groups.get(meta.runtime).compilers.push(entry);
  });
  return [...groups.entries()].map(([runtime, group]) => {
    const stable = group.compilers.find(entry => !/head|experimental|master/i.test(`${entry.name} ${entry.version || ""}`)) || group.compilers[0];
    return {
      provider: "wandbox",
      language: `wandbox:${encodeURIComponent(runtime)}`,
      version: stable.name,
      aliases: group.compilers.map(entry => entry.name),
      baseLanguage: runtime,
      ext: group.meta.extension,
      displayName: group.meta.name,
      defaultVersion: stable.name,
      ...(group.meta.starter ? { starter: group.meta.starter } : {}),
      versions: group.compilers.map(entry => ({
        id: entry.name,
        name: entry.version || entry.name,
        label: entry.version ? `${entry.name} (${entry.version})` : entry.name
      }))
    };
  });
}

function compilerForRuntime(runtime, compilers) {
  const key = String(runtime || "").toLowerCase();
  const explicitPrefix = "wandbox:";
  if (key.startsWith(explicitPrefix)) {
    let name;
    try {
      name = decodeURIComponent(String(runtime).slice(explicitPrefix.length));
    } catch (error) {
      throw new WandboxError("Invalid Wandbox compiler selection.", 400);
    }
    const exact = compilers.find(entry => entry.name === name && compilerMeta(entry));
    if (!exact) throw new WandboxError("That Wandbox compiler is no longer available. Sync languages and try again.", 400);
    return exact;
  }

  const language = RUNTIME_LANGUAGE[key];
  if (!language) throw new WandboxError(`Wandbox does not support the "${runtime}" runtime.`, 400);
  const candidates = compilers.filter(entry => {
    if (language === "Python 2") return entry.language === "Python" && /cpython-2(?:\.|$)/i.test(entry.name);
    if (language === "Python") return entry.language === "Python" && !/cpython-2(?:\.|$)/i.test(entry.name);
    if (key === "csharp.net") return entry.language === "C#" && /^dotnetcore-/i.test(entry.name);
    return entry.language === language || (language === "C++" && entry.language === "CPP");
  });
  if (!candidates.length) throw new WandboxError(`Wandbox has no compiler available for ${language}.`, 400);
  return candidates.find(entry => !/head|experimental|master/i.test(`${entry.name} ${entry.version || ""}`)) || candidates[0];
}

function boundedOutput(value) {
  const text = typeof value === "string" ? value : "";
  if (new TextEncoder().encode(text).byteLength <= MAX_OUTPUT_BYTES) return text;
  return `${text.slice(0, MAX_OUTPUT_BYTES)}\n[Output truncated by Sprig]`;
}

export async function execute(payload, fetchImpl = fetch, signal) {
  if (!payload || typeof payload !== "object" || typeof payload.language !== "string" ||
      !Array.isArray(payload.files) || payload.files.length !== 1 ||
      !payload.files[0] || typeof payload.files[0].content !== "string") {
    throw new WandboxError("A language and exactly one source file are required.", 400);
  }
  const source = payload.files[0].content;
  const stdin = payload.stdin === undefined || payload.stdin === null ? "" : payload.stdin;
  if (typeof stdin !== "string") throw new WandboxError("Standard input must be text.", 400);
  if (new TextEncoder().encode(source).byteLength > MAX_SOURCE_BYTES) {
    throw new WandboxError("Source file is too large (maximum 128 KB).", 413);
  }
  if (new TextEncoder().encode(stdin).byteLength > MAX_STDIN_BYTES) {
    throw new WandboxError("Standard input is too large (maximum 64 KB).", 413);
  }

  const compilers = await getCompilerList(fetchImpl, signal);
  const compiler = compilerForRuntime(payload.language, compilers);
  let response;
  try {
    response = await fetchImpl(`${API_BASE}/compile.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ compiler: compiler.name, code: source, stdin, save: false }),
      signal
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new WandboxError("Could not reach Wandbox execution service.");
  }
  if (!response.ok) throw new WandboxError(`Wandbox execution failed (HTTP ${response.status}).`);

  let result;
  try {
    result = await response.json();
  } catch (error) {
    throw new WandboxError("Wandbox returned an invalid execution response.");
  }
  if (!result || typeof result.status !== "string") {
    throw new WandboxError("Wandbox returned an invalid execution response.");
  }

  const failed = result.status !== "0";
  const compileOutput = boundedOutput(result.compiler_output);
  const compileError = boundedOutput(result.compiler_error || (!result.compiler_output && result.compiler_message) ||
    (failed && result.signal ? `Process stopped by signal ${result.signal}.` : ""));
  const runCode = Number.isInteger(Number(result.program_exit_code)) ? Number(result.program_exit_code) : (failed ? 1 : 0);
  return {
    compile: {
      stdout: compileOutput,
      stderr: compileError,
      code: failed ? 1 : 0,
      signal: null
    },
    run: {
      stdout: boundedOutput(result.program_output),
      stderr: boundedOutput(result.program_error),
      code: runCode,
      signal: null
    }
  };
}
