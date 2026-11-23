const http = require("http");

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : "";
    const r = http.request({
      hostname: "127.0.0.1", port: 3001, path, method,
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
    }, res => {
      let b = "";
      res.on("data", c => b += c);
      res.on("end", () => resolve({ status: res.statusCode, body: b }));
    });
    r.on("error", reject);
    r.end(data);
  });
}

(async () => {
  const batch = await req("POST", "/api/v2/execute", {
    language: "node", version: "*",
    files: [{ name: "main.js", content: "const fs=require('fs'); const s=fs.readFileSync(0,'utf8'); console.log('GOT:'+JSON.stringify(s));" }],
    stdin: "hello\n"
  });
  console.log("BATCH", batch.status, batch.body);

  const session = "t1";
  const streamP = req("POST", "/api/v2/execute", {
    language: "node", version: "*", interactive: true, closeStdin: false, session,
    files: [{ name: "main.js", content: "const readline=require('readline'); const rl=readline.createInterface({input:process.stdin}); rl.on('line', line => { console.log('LINE:'+line); if(line==='quit') rl.close(); });" }],
    stdin: ""
  });
  await new Promise(r => setTimeout(r, 500));
  console.log("PUSH", await req("POST", "/api/v2/stdin", { session, data: "Ada\n" }));
  await new Promise(r => setTimeout(r, 300));
  console.log("PUSH2", await req("POST", "/api/v2/stdin", { session, data: "quit\n", close: true }));
  console.log("STREAM", await streamP);

  const piston = await new Promise(resolve => {
    const r = http.request({ hostname: "127.0.0.1", port: 2000, path: "/api/v2/runtimes", method: "GET", timeout: 1500 }, res => resolve("piston " + res.statusCode));
    r.on("error", e => resolve("piston down " + e.message));
    r.on("timeout", () => { r.destroy(); resolve("piston timeout"); });
    r.end();
  });
  console.log(piston);
})().catch(e => { console.error("ERR", e); process.exit(1); });
