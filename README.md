# Sprig Online Compiler

Sprig is a browser-based code editor with local and hosted execution support.

## Local development

Requirements: Node.js and PowerShell on Windows.

```powershell
node .\sprig-runner.js
```

Open `http://127.0.0.1:3001`. The local runner only supports languages whose runtimes are installed on the machine. `flix.jar` is intentionally excluded from this repository; add a licensed copy locally if you need the Flix runtime.

## GitHub Codespaces

The Codespace starts Piston and the Sprig runner automatically. Open the private forwarded port 3001 to use the editor; select PowerShell and run code as usual. On first startup, the setup script installs Piston's PowerShell runtime and keeps its packages in the ignored `.piston-data/` directory.

To start or repair the services manually from the repository root:

```bash
bash .devcontainer/start-sprig.sh
```

Port 2001 is loopback-only inside the Codespace and is not forwarded. Port 3001 serves both the editor and its code-execution API, so it must remain private. The public Pages site is separate and cannot use this private runner.

## Tests and Pages build

```powershell
node --test .\tests\onlinecompiler-proxy.test.mjs .\tests\sprig-runner-piston.test.mjs
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
