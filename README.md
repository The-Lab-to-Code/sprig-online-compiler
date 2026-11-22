# Sprig Online Compiler

Sprig is a browser-based code editor with local and hosted execution support.

## Local development

Requirements: Node.js and PowerShell on Windows.

```powershell
node .\sprig-runner.js
```

Open `http://127.0.0.1:3001`. The local runner only supports languages whose runtimes are installed on the machine. `flix.jar` is intentionally excluded from this repository; add a licensed copy locally if you need the Flix runtime.

## Tests and Pages build

```powershell
node --test .\tests\onlinecompiler-proxy.test.mjs
.\build-pages.ps1
```

The Pages build writes static assets to `site/`. Wrangler deploys the Pages Function from `functions/`.

## Hosted execution

The hosted Piston-compatible proxy uses OnlineCompiler.io. Configure `ONLINECOMPILER_API_KEY` as a Cloudflare Pages secret; never put the provider key in browser code, source files, or this repository.

```powershell
npx wrangler pages secret put ONLINECOMPILER_API_KEY --project-name sprig-online-compiler
.\build-pages.ps1
npx wrangler pages deploy .\site --project-name sprig-online-compiler --branch main
```

Hosted execution sends submitted code and input to the provider. Check the provider's current privacy policy and usage limits before enabling the proxy.
