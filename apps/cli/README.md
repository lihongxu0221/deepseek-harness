# `@deepseek-ai/dsh`

English | [中文](README.zh.md)

The `dsh` command is the sole supported Node application launcher: profiles are ordered stacks of plugin-bundle patch layers under the user's own overrides. SDK and ACP are profiles, not separate public bins. The Python runtime wheel packages this same command; the SDK defaults to `sdk`, and the minimal example selects `sdk-minimal`. [`src/args.ts`](src/args.ts) owns the command grammar, and [`src/bin.ts`](src/bin.ts) loads only the selected runner. Invalid commands, options from another mode, configuration errors, and boot failures exit nonzero.

## Entry modes

| Command | Purpose |
|---|---|
| `dsh --profile <name>` | Boot the named profile under `$DSH_HOME/profiles/<name>`. |
| `dsh --profile acp` | Serve automation clients over ACP stdio until disconnect. |
| `dsh --profile headless "job"` | Run one fresh persisted session, print the final answer, and exit. |
| `dsh --profile sdk` | Serve SDK clients over JSON-RPC stdio until shutdown or disconnect. |
| `dsh --profile sdk-minimal` | Serve SDK clients with the standalone minimal agent tree. |
| `dsh web` | Alias of `--profile web`. |
| `dsh plugin --profile <name> <pnpm args>` | Manage a profile's plugins by forwarding to pnpm in the profile directory. |

The invoking directory is the default workspace root. The `web`, `headless`, `sdk`, `sdk-minimal`, and `acp` profiles auto-initialize on first use from shipped templates; any other profile must be created through `dsh plugin`.

## App arguments

The launcher parses only its own flags and hands everything after them to the booted profile, where any injected app plugin may parse the shared immutable snapshot ([`dsh-cmdline`](../../packages/boot/cmdline/README.md)). The first token the launcher does not recognize starts the app's arguments:

```sh
dsh --profile web --port 8080       # --port belongs to the web app
dsh --profile tui --resume <id>     # example, assuming the tui profile is installed; --resume belongs to the terminal app
dsh --profile headless "run the tests"
dsh --profile web --help            # the web app's flags, not the launcher's
dsh --help                          # the launcher's own help
```

<a id="profiles"></a>
## Profiles

A profile directory holds a `package.json` (out-of-tree plugin dependencies plus the profile manifest `dsh.profile` with its ordered `bundles` list and `patchReload` lifecycle) and a `cordis.patch.yml` (the user's own patch layer). `patchReload: live` watches the profile and home-level patch files; `startup` applies them once.

The tree composes over an empty root:
- each bundle's patch in `dsh.profile.bundles` order
- then the profile's `cordis.patch.yml`, then the home-level `$DSH_HOME/cordis.patch.yml`
- then `--patch` overlays

Bundles named in `dsh.profile.bundles` resolve from the dsh installation first (`@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, `@deepseek-ai/dsh-headless`, `@deepseek-ai/dsh-sdk-app`, `@deepseek-ai/dsh-sdk-minimal`, `@deepseek-ai/dsh-acp-app`), then from the profile's own `node_modules`, where pnpm installs out-of-tree plugins.

Use `--dump-default-config` and `--dump-config` to inspect the composed tree without booting it.

The [CLI behavior reference](reference/README.md) owns exact layer precedence, flags, shutdown behavior, deployment defaults, and source execution.

## Packaged desktop executable

`dist-exe/dsh-web-<platform>-<arch>/` is the double-click Web GUI folder. `dsh-web.exe` is only a thin launcher; keep `lib/`, `config/`, and `node_modules/` beside it. The folder is self-contained: the exe embeds Node, so a machine does not need a system Node.js or Python install to open the GUI. When the first extra argument is an existing `.js`/`.cjs`/`.mjs` file, the launcher imports that script instead of the GUI so native helpers can reuse the exe as Node. That import first rewrites argv to `[exe, script, ...scriptArgs]` so the worker's `process.argv.slice(2)` matches Node. When the first extra argument is `plugin`, the launcher runs the CLI plugin command against `.config` instead of claiming the single-instance GUI lock. The same dispatch applies when a shell re-invokes the executable by name (`cmd /c dsh plugin …`): the SEA normalizes argv[0] to the executable path and preserves the as-typed token (`dsh`) in the next slot, and that invocation echo is skipped so it cannot push the invocation into the GUI guest path. Plugin Market probes and installs hide Windows `cmd.exe` consoles. `-e`/`--eval <source>` runs the inline source, which is how helpers that spawn the exe as Node (the Plugin Market's restart helper) evaluate their program. The executable's directory is prepended to `PATH` on Windows so children re-invoke `dsh` by name whether or not the folder is on the user's PATH. The pack step copies the launcher to `dsh.exe` (Windows) or `dsh` beside `dsh-web` so that PATH name exists. Double-click boots the `web` profile, opens the process-token local URL in an Edge or Chrome app-mode window, and treats that folder as the invoking directory. The tray Open-URL item uses the same authenticated address. Unless `$DSH_HOME` is already set, user data lives in `.config/` beside the exe — the packaged equivalent of `~/.dsh`. The pack step seeds `.config/profiles/web` with the plugins pinned in `scripts/builtin-profile-plugins.json` so the first launch already has the market and UI plugins; a rebuild keeps an existing `.config` and only appends missing pins. Seeded `@linxin666/dsh-remote-web-ui` and `@linxin666/dsh-client-ui-task-board` inject `apiProxy`, which this product does not provide, so the launcher disables those rows and mounts the rest of the pin list. On Windows the launcher is a GUI process: a splash window shows boot progress, then the main window opens, and a tray icon stays after the window closes. Right-click the tray icon to show the GUI, open the listen URL, start or stop the service, open Settings, or exit. On macOS/Linux, close the app window or the console to stop. This is not the JSON-RPC `dsh-jsonrpc-agent-pkg` executable.

From the repository root, run `build-exe.bat` on Windows or `pnpm run build:web-exe`. The packer writes `VERSION` beside the launcher; a `winexeBuilder` or `winexeNew` push stamps `<package-version>.winexe.<GitHub run>` and publishes a prerelease zip. Settings → General can check that GitHub Releases list for a newer zip and replace program files while keeping `.config`.

## Optional overlays

`config/examples/` ships opt-in overlays for GitHub review webhooks, session-local Schedule, memory MCP servers, and runtime Cordis tools. They are never part of a default profile; the [user guides](../../docs/user/guide/index.md) and [developer practice guides](../../docs/user/develop/practice/index.md) own setup and safety instructions.
## Development

Production runs require built package and frontend artifacts. From the repository root, run `pnpm run build` separately, then use `pnpm dsh <args...>` to run the TypeScript entry and forward every argument; the [source-execution reference](reference/README.md#source-execution) owns the module-resolution contract.
