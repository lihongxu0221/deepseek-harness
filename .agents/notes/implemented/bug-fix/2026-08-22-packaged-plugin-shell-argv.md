# Agent Note: Packaged plugin installs died in the GUI guest path when a shell spawned `dsh`

Status: implemented

English | [中文](2026-08-22-packaged-plugin-shell-argv.zh.md)

## Problem

The [2026-08-20 CLI-head dispatch](2026-08-20-packaged-desktop-plugin-cli.md) skipped the launcher's own slots by comparing each remaining argv entry against argv[0]. The Plugin Market's Windows fallback spawns `cmd /d /s /c "dsh plugin --profile web add …"`, and the SEA rewrites argv before the entry runs: argv[0] becomes the absolute executable path while the token as typed — `dsh` — is preserved in the next slot. The skip did not recognize that echo, `packagedCliArgv` saw `dsh` (not `plugin`) as the head, and the whole invocation fell to the desktop guest path — `show`, exit 0, pnpm never ran. The market read the clean exit as success, re-checked the installed version, and reported `STALE(release-age)`; `desktop-host.log` recorded one `role=guest` line per attempt while the owner kept running. (Trace evidence: `cmd /c dsh --version` inside the SEA yields `argv = [<exe>, "dsh", "--version"]`.)

Two more packaged-only failures stacked on that one. The shipped folder is not on the user's PATH, so the same `cmd /c dsh …` and the market's restart replay (`& 'dsh'` under PowerShell) cannot resolve the executable at all on a default machine. And the market's restart helper spawns `nodeExecutable()` with `['-e', <source>]`; inside the packaged host `process.argv0` is the product exe, so the helper process ran the desktop path as a guest and the helper source never executed — a restart killed the host and started no replacement (`the replacement did not bind port … within 20s` in `dsh-market-restart-*.err.log` under the temp directory).

## Decision

`extraPackagedArgv` in `apps/cli/src/packaged-web-entry.ts` and its copy in `apps/cli/packaged-web-launcher.cjs` now skip a leading entry that is the invocation echo (`isInvocationEcho`): a non-option entry that resolves to `process.execPath`, whose stem matches the executable, or whose stem is `dsh` / `dsh-web` (the product exe and the market's PATH name). They also skip `lib/bin.js` beside the exe, so a spawn that already named the CLI entry still reaches `plugin`. The GUI owner does not rewrite `process.argv[1]` to `lib/bin.js`: `dshArgv()` would then spawn this executable with that path, the SEA would import `bin.js` as a worker, and `process.argv.slice(2)` would still contain the file path — the root parser then reports `--profile <name> is required` instead of running `plugin`. Empty `cmd.exe` windows are hidden in the launcher wrap below, not by an entry-level patch. `lib/packaged-web-bin.js` prepends the executable's directory to `env.PATH` (win32 only, idempotent per directory) before any branch, so children re-invoke `dsh` by name. The pack step copies the launcher to `dsh.exe` (Windows) or `dsh` (POSIX) beside `dsh-web`, because PATH prepend only helps when that file exists. The entry evaluates `-e`/`--eval <source>` by writing the source to a temp `.cjs` and importing it — the same capability the existing script-file argument already grants — setting exit code 1 when the source throws and removing the temp file after the import settles. `apps/cli/src/plugin.ts` passes `windowsHide: true` to the pnpm `spawnSync` so the Windows `.cmd` shim does not open a second empty console when the parent is a GUI-subsystem exe. The embedded CJS launcher (`packaged-web-launcher.cjs`) also wraps `child_process.spawn` / `spawnSync` with `windowsHide` on win32, but only for console hosts (`cmd`, `powershell`, `pwsh`, `.cmd`/`.bat`, or `shell: true`). A blanket hide also covered Edge/Chrome `--app` and the main window never appeared. The wrap must sit in the launcher: static ESM imports of the entry bundle hoist above any entry-level patch, and the `node:child_process` ESM facade snapshots whatever the CJS exports hold at first import.

## Alternatives considered

**Match argv[0] only, as before.** Rejected: direct spawns work, but every cmd/PowerShell spawn misses, and the market's Windows shim route is exactly cmd.

**Have the market spawn the absolute executable.** Rejected: `dshArgv()` is the market's own code and falls back to a PATH name from its argv; this repo cannot change it, and the missing PATH entry still broke the restart replay.

**Rewrite the GUI `argv[1]` to `lib/bin.js` so `dshArgv()` spawn()s the exe without cmd.** Rejected: the SEA then imports `bin.js` as a worker and `parseDshArgs(process.argv.slice(2))` sees the file path as a user argument, which prints `--profile <name> is required`.

**Fix only the embedded CJS launcher.** Rejected: the on-disk entry recomputes extra argv after import; both copies own the same skip and stay symmetric.

## Consequences

`cmd /c dsh plugin …` from the packaged app now dispatches to the CLI and runs pnpm against `.config/profiles/web`, so market installs and updates land. The market's in-process spawn still uses `cmd /c dsh` on Windows; the console is hidden. The market's restart helper runs its source under the packaged exe, and its replacement replay resolves `dsh` through the injected PATH entry and boots as the pipe owner. `apps/cli/tests/packaged-web-entry.spec.ts` pins the shell-token skip, the `lib/bin.js` skip, the PATH prepend, the eval-source resolution, and the launcher's console-only hide wrap; the packaged-desktop README section documents these behaviors.
