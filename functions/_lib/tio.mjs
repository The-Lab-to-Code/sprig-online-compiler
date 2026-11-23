const TIO_ORIGIN = "https://tio.run";
const MAX_SOURCE_BYTES = 128 * 1024;
const MAX_STDIN_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const nativeFetch = globalThis.fetch;
let cachedCatalog;
let catalogExpiresAt = 0;

const LANGUAGE_META = {
  "abc": ["abc", "txt"],
  "abc-assembler": ["abc-assembler", "txt"],
  "ada": ["ada", "adb"],
  "agda": ["agda", "agda"],
  "algol": ["algol", "alg"],
  "lolcode": ["lolcode", "lol"],
  "alice ml": ["alice-ml", "aml"],
  "apl": ["apl", "apl"],
  "awk": ["awk", "awk"],
  "assembly": ["assembly", "asm"],
  "ats2": ["ats2", "dats"],
  "attache": ["attache", "att"],
  "bash": ["bash", "sh"],
  "bc": ["bc", "bc"],
  "beanshell": ["beanshell", "bsh"],
  "befunge-93": ["befunge93", "b93"],
  "brainfuck": ["@bf", "bf"],
  "boo": ["boo", "boo"],
  "cobol": ["cobol", "cob"],
  "chapel": ["chapel", "chpl"],
  "clean": ["clean", "icl"],
  "clips": ["clips", "clp"],
  "coconut": ["coconut", "coco"],
  "coq": ["coq", "v"],
  "c": ["c", "c"],
  "c++": ["c++", "cpp"],
  "c#": ["csharp", "cs"],
  "curry": ["curry", "curry"],
  "dafny": ["dafny", "dfy"],
  "d": ["d", "d"],
  "clojure": ["clojure", "clj"],
  "factor": ["factor", "factor"],
  "fantom": ["fantom", "fan"],
  "fish": ["fish", "fish"],
  "flix": ["flix", "flix"],
  "effekt": ["effekt", "effekt"],
  "coffeescript": ["@coffee", "coffee"],
  "common lisp": ["lisp", "lisp"],
  "gap": ["gap", "g"],
  "gnuplot": ["gnuplot", "gp"],
  "haxe": ["haxe", "hx"],
  "idris": ["idris", "idr"],
  "icon": ["icon", "icn"],
  "io": ["io", "io"],
  "j": ["j", "ijs"],
  "jq": ["jq", "jq"],
  "emacs lisp": ["emacs", "el"],
  "bqn": ["bqn", "bqn"],
  "brachylog": ["brachylog", "brachylog"],
  "cjam": ["cjam", "cjam"],
  "golfscript": ["golfscript", "gs"],
  "japt": ["japt", "japt"],
  "jelly": ["jelly", "jelly"],
  "matl": ["matl", "matl"],
  "pyth": ["pyth", "pyth"],
  "rockstar": ["rockstar", "rock"],
  "vyxal": ["vyxal", "vyxal"],
  "husk": ["husk", "husk"],
  "05ab1e": ["osabie", "abe"],
  "k": ["k", "k"],
  "koka": ["koka", "kk"],
  "postscript": ["postscript", "ps"],
  "javascript": ["@js", "js"],
  "python": ["@py", "py"],
  "typescript": ["@ts", "ts"],
  "r": ["rscript", "r"],
  "raku": ["raku", "raku"],
  "octave": ["octave", "m"],
  "racket": ["racket", "rkt"],
  "pascal": ["pascal", "pas"],
  "powershell": ["powershell", "ps1"],
  "smalltalk": ["smalltalk", "st"],
  "v": ["vlang", "v"],
  "kotlin": ["kotlin", "kt"],
  "vim script": ["vimscript", "vim"],
  "vim": ["vimscript", "vim"],
  "lazy k": ["lazyk", "lazyk"],
  "ruby": ["ruby", "rb"],
  "java": ["java", "java"],
  "go": ["go", "go"],
  "rust": ["rust", "rs"],
  "haskell": ["haskell", "hs"],
  "lua": ["@lua", "lua"],
  "perl": ["perl", "pl"],
  "php": ["php", "php"],
  "swift": ["swift", "swift"],
  "scala": ["scala", "scala"],
  "elixir": ["elixir", "exs"],
  "erlang": ["erlang", "erl"],
  "fortran": ["fortran", "f90"],
  "ocaml": ["ocaml", "ml"],
  "prolog": ["prolog", "pl"],
  "julia": ["julia", "jl"],
  "nim": ["nim", "nim"],
  "zig": ["zig", "zig"],
  "dart": ["dart", "dart"],
  "crystal": ["crystal", "cr"],
  "dash": ["dash", "sh"],
  "pony": ["ponylang", "pony"],
  "groovy": ["groovy", "groovy"],
  "f#": ["fsharp.net", "fs"],
  "sqlite": ["sqlite3", "sql"],
  "sql": ["sqlite3", "sql"],
  "scheme": ["scheme", "scm"],
  "solidity": ["solidity", "sol"],
  "tcl": ["tcl", "tcl"],
  "vala": ["vala", "vala"],
  "vhdl": ["vhdl", "vhd"],
  "visual basic .net": ["basic.net", "vb"],
  "whitespace": ["whitespace", "ws"]
};

const RUNTIME_FAMILY = {
  awk: "awk",
  bash: "bash",
  "befunge-93": "befunge93",
  brainfuck: "@bf",
  c: "c",
  "c++": "c++",
  "c#": "csharp",
  "common lisp": "common lisp",
  cobol: "cobol",
  clojure: "clojure",
  "coffeescript": "@coffee",
  d: "d",
  dart: "dart",
  elixir: "elixir",
  erlang: "erlang",
  effekt: "effekt",
  flix: "flix",
  forth: "forth",
  fortran: "fortran",
  "f#": "fsharp.net",
  go: "go",
  groovy: "groovy",
  haskell: "haskell",
  java: "java",
  javascript: "@js",
  "node.js": "@js",
  bqn: "bqn",
  brachylog: "brachylog",
  cjam: "cjam",
  golfscript: "golfscript",
  japt: "japt",
  jelly: "jelly",
  matl: "matl",
  pyth: "pyth",
  rockstar: "rockstar",
  vyxal: "vyxal",
  husk: "husk",
  "05ab1e": "osabie",
  kotlin: "kotlin",
  "emacs lisp": "emacs",
  julia: "julia",
  lua: "lua",
  nim: "nim",
  ocaml: "ocaml",
  octave: "octave",
  perl: "perl",
  pascal: "pascal",
  php: "php",
  powershell: "powershell",
  prolog: "prolog",
  python: "@py",
  r: "r",
  raku: "raku",
  racket: "racket",
  ruby: "ruby",
  rust: "rust",
  scala: "scala",
  swift: "swift",
  smalltalk: "smalltalk",
  typescript: "@ts",
  v: "vlang",
  "vim script": "vimscript",
  "lazy k": "lazyk",
  "visual basic .net": "basic.net",
  zig: "zig"
};
const FAMILY_ALIASES = {
  "node.js": "javascript",
  "powershell core": "powershell"
};
const FAMILY_DISPLAY_NAMES = {
  javascript: "JavaScript",
  powershell: "PowerShell"
};
const EXISTING_RECREATIONAL_FAMILIES = new Set([
  "05ab1e", "befunge-93", "brachylog", "cjam", "golfscript", "husk",
  "japt", "jelly", "lolcode", "matl", "pyth", "rockstar"
]);

export class TioError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = "TioError";
    this.status = status;
  }
}

function normalizedName(value) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function familyName(value) {
  return normalizedName(value.replace(/\s*\([^)]*\)$/, "").replace(/\s+\d+(?:\.\d+)*$/, ""));
}

async function fetchText(fetchImpl, url, signal, label) {
  let response;
  try {
    response = await fetchImpl(url, { signal });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new TioError(`Could not reach TIO ${label}.`);
  }
  if (!response.ok) throw new TioError(`TIO ${label} request failed (HTTP ${response.status}).`);
  return response.text();
}

async function getCatalog(fetchImpl = fetch, signal) {
  if (fetchImpl === nativeFetch && cachedCatalog && Date.now() < catalogExpiresAt) return cachedCatalog;
  const home = await fetchText(fetchImpl, `${TIO_ORIGIN}/`, signal, "homepage");
  const scriptPath = home.match(/<script src="([^"]*frontend\.js)"/i)?.[1];
  if (!scriptPath) throw new TioError("TIO did not provide its runtime catalog.");
  const script = await fetchText(fetchImpl, new URL(scriptPath, TIO_ORIGIN).href, signal, "frontend metadata");
  const runPath = script.match(/var runURL = "([^"]+)"/)?.[1];
  const languagePath = script.match(/languageFileRequest\.open\("GET", "([^"]+)"/)?.[1];
  if (!runPath || !languagePath) throw new TioError("TIO returned incomplete runtime metadata.");
  const languageJson = await fetchText(fetchImpl, new URL(languagePath, TIO_ORIGIN).href, signal, "language catalog");
  let catalog;
  try {
    catalog = JSON.parse(languageJson);
  } catch (error) {
    throw new TioError("TIO returned an invalid language catalog.");
  }
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    throw new TioError("TIO returned an invalid language catalog.");
  }
  const result = { runPath, languages: catalog };
  if (fetchImpl === nativeFetch) {
    cachedCatalog = result;
    catalogExpiresAt = Date.now() + 5 * 60 * 1000;
  }
  return result;
}

function getLanguageGroups(languages) {
  const groups = new Map();
  for (const [id, language] of Object.entries(languages)) {
    if (!language || !Array.isArray(language.categories) || typeof language.name !== "string") continue;
    const name = familyName(language.name);
    if (!language.categories.includes("practical") &&
        !(language.categories.includes("recreational") && EXISTING_RECREATIONAL_FAMILIES.has(name))) continue;
    const key = /^perl6(?:-|$)/.test(id) ? "raku" : FAMILY_ALIASES[name] || name;
    if (!groups.has(key)) groups.set(key, { key, name: FAMILY_DISPLAY_NAMES[key] || name, versions: [] });
    groups.get(key).versions.push({ id, name: language.name });
  }
  return [...groups.values()].map(group => {
    group.versions.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const meta = LANGUAGE_META[group.key];
    const runtime = RUNTIME_FAMILY[group.key];
    const extension = meta ? meta[1] : group.key.replace(/[^a-z0-9]/g, "").slice(0, 8) || "txt";
    const baseLanguage = meta ? meta[0] : runtime || `tio:${group.key}`;
    const preferred = group.versions.find(version => /^python\s*3(?:\b|[.(])/i.test(version.name) || /cpython/i.test(version.name));
    const defaultVersion = (preferred || group.versions[0]).id;
    const requests = languages[defaultVersion].tests?.helloWorld?.request;
    const starter = Array.isArray(requests)
      ? requests.find(request => request?.command === "F" && typeof request.payload?.[".code.tio"] === "string")?.payload[".code.tio"]
      : undefined;
    return {
      provider: "tio",
      language: `tio:${encodeURIComponent(group.key)}`,
      baseLanguage,
      ext: extension,
      displayName: group.name.replace(/^./, character => character.toUpperCase()),
      tioKey: group.key,
      defaultVersion,
      ...(starter ? { starter } : {}),
      versions: group.versions.map(version => ({
        id: version.id,
        name: version.name,
        label: version.name
      }))
    };
  });
}

export async function listRuntimes(fetchImpl = fetch) {
  const { languages } = await getCatalog(fetchImpl);
  return getLanguageGroups(languages);
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function tioState(languageId, code, stdin) {
  const field = (name, value) => `F${name}\0${byteLength(value)}\0${value}`;
  return `Vlang\0${1}\0${languageId}\0${field(".code.tio", code)}${field(".input.tio", stdin)}Vargs\0${0}\0R`;
}

async function transform(compression, bytes) {
  let stream;
  try {
    stream = new compression("deflate-raw");
  } catch (error) {
    throw new TioError("This runtime cannot encode TIO requests.");
  }
  const writer = stream.writable.getWriter();
  await writer.write(bytes);
  await writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
}

function boundedOutput(value) {
  if (value.length <= 64 * 1024) return value;
  return `${value.slice(0, 64 * 1024)}\n[Output truncated by Sprig]`;
}

function selectLanguage(payload, groups) {
  const prefix = "tio:";
  let key = String(payload.language || "").toLowerCase();
  if (key.startsWith(prefix)) {
    try {
      key = decodeURIComponent(String(payload.language).slice(prefix.length));
    } catch (error) {
      throw new TioError("Invalid TIO language selection.", 400);
    }
  } else {
    key = RUNTIME_FAMILY[key] || key;
  }
  const group = groups.find(item => item.tioKey === key);
  if (!group) throw new TioError(`TIO does not support the "${payload.language}" runtime.`, 400);
  const version = typeof payload.version === "string" && payload.version !== "*" ? payload.version : group.defaultVersion;
  if (!group.versions.some(item => item.id === version)) {
    throw new TioError("The selected TIO version is unavailable. Sync languages and try again.", 400);
  }
  return version;
}

async function runTio(runPath, languageId, code, stdin, fetchImpl, signal) {
  const state = tioState(languageId, code, stdin);
  const compressed = await transform(CompressionStream, new TextEncoder().encode(state));
  for (let attempt = 0; attempt < 2; attempt++) {
    let response;
    try {
      response = await fetchImpl(new URL(`${runPath}/${randomToken()}`, TIO_ORIGIN).href, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "Origin": TIO_ORIGIN,
          "Referer": `${TIO_ORIGIN}/`
        },
        body: compressed,
        signal
      });
    } catch (error) {
      if (error.name === "AbortError") throw error;
      throw new TioError("Could not reach TIO execution service.");
    }
    if (response.status === 204 && attempt === 0) continue;
    if (!response.ok) {
      const message = (await response.text()).slice(0, 500);
      throw new TioError(message || `TIO execution failed (HTTP ${response.status}).`);
    }
    const contentLength = Number(response.headers.get("Content-Length") || 0);
    if (contentLength > MAX_RESPONSE_BYTES) throw new TioError("TIO response is too large.");
    const responseBytes = new Uint8Array(await response.arrayBuffer());
    if (responseBytes.byteLength > MAX_RESPONSE_BYTES || responseBytes.byteLength < 18) {
      throw new TioError("TIO returned an invalid execution response.");
    }
    const raw = await transform(DecompressionStream, responseBytes.subarray(10, responseBytes.byteLength - 8));
    const decoded = new TextDecoder().decode(raw);
    const separator = decoded.slice(0, 16);
    if (!separator) throw new TioError("TIO returned an invalid execution response.");
    const fields = decoded.slice(16).split(separator);
    const warnings = fields.pop() || "";
    const stdout = fields[0] || "";
    const debug = fields[1] || "";
    const exitMatch = debug.match(/Exit code (-?\d+)/);
    return {
      compile: { stdout: "", stderr: "", code: 0, signal: null },
      run: {
        stdout: boundedOutput(stdout),
        stderr: boundedOutput(warnings),
        code: exitMatch ? Number(exitMatch[1]) : 0,
        signal: null
      }
    };
  }
  throw new TioError("TIO execution was not started.");
}

export async function execute(payload, fetchImpl = fetch, signal) {
  if (!payload || typeof payload !== "object" || typeof payload.language !== "string" ||
      !Array.isArray(payload.files) || payload.files.length !== 1 ||
      !payload.files[0] || typeof payload.files[0].content !== "string") {
    throw new TioError("A language and exactly one source file are required.", 400);
  }
  const code = payload.files[0].content;
  const stdin = payload.stdin === undefined || payload.stdin === null ? "" : payload.stdin;
  if (typeof stdin !== "string") throw new TioError("Standard input must be text.", 400);
  if (byteLength(code) > MAX_SOURCE_BYTES) throw new TioError("Source file is too large (maximum 128 KB).", 413);
  if (byteLength(stdin) > MAX_STDIN_BYTES) throw new TioError("Standard input is too large (maximum 64 KB).", 413);

  const { runPath, languages } = await getCatalog(fetchImpl, signal);
  const groups = getLanguageGroups(languages);
  const languageId = selectLanguage(payload, groups);
  return runTio(runPath, languageId, code, stdin, fetchImpl, signal);
}
