# Agent Note: Packaged Web desktop executable

Status: implemented

English | [中文](2026-08-18-packaged-web-desktop-exe.zh.md)

## Problem

`dsh-jsonrpc-agent-pkg-*.exe` is a stdio JSON-RPC server. Double-clicking it prints a ready line and waits on stdin. That is the correct Python SDK carrier, and it is the wrong first-run product for someone who wants to click an exe and use the Web GUI.

`pnpm dsh web` already is the official browser UI. Asking the user to keep a source checkout and run a command is the opposite of a packaged desktop launch.

## Decision

Ship `dist-exe/dsh-web-<platform>-<arch>/` as a second product. `dsh-web` is a thin `@yao-pkg/pkg --sea` launcher. Node's SEA embedder runs that entry as CommonJS (`embedderRunCjs`), so the committed file is `apps/cli/packaged-web-launcher.cjs`. It dynamically imports on-disk `lib/packaged-web-bin.js` from the same folder. When the first extra argument is an existing `.js`/`.cjs`/`.mjs` file, the launcher and that on-disk entry import the script instead of booting the GUI, so `spawn(process.execPath, [worker.cjs])` from the Win32 folder picker behaves like node and stays on the packaged ABI. pkg SEA puts the exe path in both `argv[0]` and `argv[1]`; those slots are skipped before the script is chosen. The rest of the folder is a `pnpm deploy` of `@deepseek-ai/dsh` (`lib/`, `config/`, `node_modules/`). After deploy, the build copies workspace and vendor packages that the legacy hoister and `link:` overrides omit, including peer Service Definitions such as `dsh-fs`. The whole folder is the product; copying only the exe fails loudly.

Double-click boots the shipped `web` profile, then opens the loopback URL in an Edge or Chrome `--app` window with a dedicated `$DSH_HOME/desktop-chromium` profile so the window is its own process. A browser that exits within 2s is treated as a launcher handoff and the server stays up. Closing a longer-lived app window, or the console, stops the server. When no Chromium browser exists, the OS opener fires and the console remains the server.

The packaged entry changes the process cwd to the executable directory before loading `.env` and booting, because Explorer's cwd is often not that directory. Unless `$DSH_HOME` is already set, it then points `$DSH_HOME` at `<exeDir>/.config` and creates that directory. That folder is the full harness home: `settings.yaml`, `.credentials.yaml`, sessions, and `desktop-chromium`. Source `pnpm dsh` is unchanged and still uses `~/.dsh`.

`scripts/build-web-exe.ts` and root `build-exe.bat` produce only this Web folder. They reuse `@yao-pkg/pkg --sea` for the thin launcher and `pnpm deploy --filter @deepseek-ai/dsh` for the closure. They do not sync into the Python runtime or run `verify-runtime-closure`. Before `rm` of a staging or product folder, the build copies an existing `.config` aside and copies it back afterward, including when deploy or pack fails.

The JSON-RPC sidecar `cordis.yml` contract is unchanged. The [single-file JSON-RPC exe](../architecture/2026-07-10-single-file-executable-sdk-runtime-distribution.md) remains the Python SDK carrier.

## Alternatives considered

**Add HTTP to the JSON-RPC exe.** Rejected because that bin is the Python SDK stdio carrier. Mixing a browser UI into it would break the ready-line contract and the sidecar config story.

**Snapshot the whole Web GUI into one pkg SEA file.** Rejected because `healProfilesModuleFallback` creates real package symlinks under `$DSH_HOME/profiles/node_modules`. A `/snapshot` path is not a real filesystem, so those links fail on Windows and plugins do not load.

**ESM file as the pkg SEA entry.** Rejected because a single-file ESM launcher is executed as CJS by the embedder and dies with `Cannot use import statement outside a module`. The JSON-RPC product avoids this by snapshotting a whole package; this product must not snapshot the GUI.

**Electron, Tauri, or WebView2 host.** Rejected as a new desktop product. App-mode Chromium is the same local URL the CLI already serves, without a second UI runtime.

**A batch file that runs `pnpm dsh web`.** Rejected because the user asked to click a built exe, not keep a checkout on PATH.

**Hide the console.** Rejected because the console is the visible server process when no Chromium browser exists, and a silent failure would look like a no-op double-click.

**Let the web Commander accept the extra worker path.** Rejected because that still boots a second Web GUI; the dialog worker never runs.

**Spawn whatever `node` is on PATH as the primary packaged path.** Rejected because a different Node may fail to load the bundled koffi binary. `$NODE_BINARY` / `$npm_node_execpath` remain an explicit override when the host exe cannot run scripts.

**Keep using `~/.dsh` for the packaged exe.** Rejected because the generated config should sit beside the program, in `.config`, as the portable equivalent of `~/.dsh`.

## Consequences

Windows users run `build-exe.bat` and double-click `dist-exe/dsh-web-win-x64/dsh-web.exe`. A machine without a system Node.js or Python install can still open the GUI, chat, add a workspace, and write an API key: the launcher embeds Node, `node_modules/` ships in the folder, and the window uses Edge or Chrome. Agent-invoked `python` or `node` commands and `dsh plugin` still require those host tools. API keys come from Settings → Models, which writes `.config/.credentials.yaml`. Re-running the build keeps `.config`. A `.env` beside the exe still works as the project layer. Unit tests in `apps/cli/tests/open-desktop-window.spec.ts`, `apps/cli/tests/packaged-web-entry.spec.ts`, `apps/cli/tests/packaged-web-home.spec.ts`, and `scripts/preserve-packaged-web-home.spec.ts` pin URL refusal, browser preference, app-mode arguments, the `start`/`open`/`xdg-open` fallbacks, the missing-folder error, that the SEA launcher stays CommonJS, that a worker script extra argument is imported instead of the GUI, the unset, whitespace, and explicit `$DSH_HOME` cases, and that rebuild deletions restore `.config`.
