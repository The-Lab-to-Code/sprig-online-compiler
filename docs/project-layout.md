# Project layout

- `index.html` is the editor and website entry point.
- `start-sprig.bat` starts the local app on Windows. `node sprig-runner.js` also works.
- `server/` contains the local runner and Sprig AI backend.
- `scripts/` contains setup and build utilities.
- `tests/` contains automated tests; `tests/manual/` contains manual checks.
- `functions/` contains the hosted Pages API, and `sprig-vendor/` contains browser runtime assets.
- `site/` is the generated Pages output. `flix.jar` is the locally installed Flix runtime.

## Windows installer

Run `npm ci` and then `npm run build:windows` on 64-bit Windows. The installer
is produced in `dist/`. The installer launches Sprig in its own application
window. Press **Alt** to reveal the hidden **Sprig** menu and check for updates
or quit. Unsaved
changes prompt for confirmation before closing. The desktop app has its own
browser storage, separate from your regular browser; save files there before
switching. Storage also remains tied to the runner's port.

The installer includes the editor, local runner, and browser assets, not
language toolchains, Docker, the optional AI model, or Flix. Those still need
to be installed separately. The installed app stores a downloaded Flix runtime
in its user-data directory, so app updates do not overwrite it. AI setup
scripts are in the installed app's `resources/app/scripts` directory.

The installed app checks GitHub Releases at startup and every 15 minutes, and
prompts before downloading and again before restarting to install. Releases
must be publicly accessible for the app to check them without credentials.
It does not update directly
from local edits or unpublished commits. The Windows release workflow builds
and publishes a GitHub Release for each push to `main`, using version
`1.0.<workflow run number>`; the repository must permit Actions to write
releases. The workflow and all required source files must first be committed
and pushed. Publishing makes the installer available to anyone who can access
the release. To publish manually, use a higher version and upload the installer,
blockmap, and `latest.yml` together. Only higher published versions are offered.
These builds are not code-signed; Windows may show a security warning.

On Windows, the launcher opens the runner after it starts. If port 3001 is
already in use, it starts a separate runner on a nearby free port; save work in
the old page before switching to the newly opened page. Keep the runner window
open while using Sprig. Browser storage is separate for each port; restarting
the runner normally reuses the same port when it is available.

For interactive PowerShell confirmations on Windows, run `npm ci` from the
project root, restart Sprig, and select **Local runner - built-in terminal** in
Settings. With no pre-entered input, type the confirmation response in
Sprig's terminal. TIO and Piston do not provide live confirmation prompts.
Graphical and Windows security dialogs remain separate. The terminal is not
designed for secret entry; do not enter passwords there.

To run in a separate Windows terminal, select **Your terminal - Windows** in
Settings. Sprig uses locally installed runtimes and compilers, without falling
back to an online service. JavaScript uses Node.js; browser-only languages
without a local runner are unavailable. Programs run with your normal user
permissions in a temporary working folder, not a sandbox or your open folder.
Enter input and stop the program in the separate terminal. Clear any queued
input in Sprig before running; the terminal window stays open after the program
finishes. Temporary files are cleaned up when that window closes while Sprig is
running. Closing Sprig does not stop the separate terminal.

Auto uses a fixed engine for each language without testing or probing engines
first. Browser languages run in the browser; other languages use Wandbox, TIO,
or the local runner. Some languages have no configured Auto engine. The app
includes a language catalog so a fresh install shows the larger list without
probing engines. Sync languages in Settings to refresh catalogs and
compiler versions; synced catalogs and chosen versions are remembered in
browser storage. Maintainers can refresh the bundled list with
`node scripts\update-language-catalog.mjs`.

The editor pairs parentheses, square and curly brackets, single and double
quotes, and backticks. It can wrap a selection, skip an existing closer, and
delete an empty pair together. Angle brackets are left alone because they are
also comparison operators.

Compiler versions and libraries depend on the execution provider; they may
differ from a locally installed toolchain and are not guaranteed to be the
latest release. TIO's Koka compiler may reject newer syntax such as `pub fun`.
Select a version offered by the provider and use syntax compatible with it.

From the project root, set up the optional local AI with
`powershell -ExecutionPolicy Bypass -File .\scripts\setup-local-ai.ps1`.
Sprig AI sends up to ten recent exchanges to the local model. Long messages
are shortened, and the oldest exchanges are omitted when needed to fit the
model's context window.

On Windows, start Docker Desktop and run
`powershell -ExecutionPolicy Bypass -File .\scripts\setup-ai-testing.ps1`
to prepare the optional AI test environments (several GB). Restart Sprig.
The test container has no network or host mounts, runs as a non-root user
with a read-only root and limited resources, and is removed afterwards.
Supported languages are JavaScript/Node.js, TypeScript, Python 3, C, C++,
Fortran, Go, Rust, Java, Ruby, PHP, PowerShell, Bash, Dash, Perl, AWK,
Erlang, Elixir, Koka, Lua, SQLite, Pascal, COBOL, Prolog, Common Lisp,
Emacs Lisp, R, Racket, OCaml and Haskell. TypeScript is compiled before running;
PowerShell uses Linux PowerShell, and Koka uses version 3.2.9.

The AI tests a program up to five times, using each error to request a repair.
A program timeout counts as a failed test. After five failures, the last
tested code is shown as **Broken**, with its last error. If a repair cannot be
completed, the last failed code is also shown as **Broken** with the number of
tests completed and the reason. Replacing the editor with broken code requires
an explicit warning and confirmation. Stopping a request cancels it instead.

If Docker or a required image is unavailable, the current code is shown as
**Untested** with setup instructions. Unsupported languages and responses
without a complete code block are also marked **Untested**. Multiple code
blocks for a supported language cannot be tested as a single program.
Generated responses are held back while testing instead of streaming live;
Activity shows progress. The dial beside Thinking counts completed tests in
steps of 20%, reaching 100% when the response is ready. It is not a time
estimate, so it may stay at 0% while the model generates a response.

This is a basic run with empty input, not a correctness or security guarantee.
Interactive, multi-file, browser-dependent, and dependency-dependent programs
may fail or need a different environment. Container versions can differ from
the editor's selected execution provider. Review all suggestions before use.
Build the Pages output with `powershell -ExecutionPolicy Bypass -File .\scripts\build-pages.ps1`.
Run the automated tests with `node --test tests\*.test.mjs`.
