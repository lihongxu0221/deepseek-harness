# Agent Note: Packaged desktop `plugin` argv must reach the CLI

Status: implemented

English | [中文](2026-08-20-packaged-desktop-plugin-cli.zh.md)

## Problem

The Plugin Market installs by spawning `dsh plugin --profile web add …`. On the packaged Windows desktop, `dsh` is the same GUI-subsystem executable that already owns `$DSH_HOME`. A second start of that executable claims the [single-instance pipe](../feature/2026-08-19-windows-packaged-desktop-tray.md) as a guest, sends `show`, and exits 0 without running pnpm.

The market treats a clean exit as a successful add, then finds no new loadable package and reports that the plugin needs a build step or ships no prebuilt artifacts. `desktop-host.log` records `role=guest` at the same timestamp as the failed install. Git-hosted skins such as `github:Small-tailqwq/dsh-deep-whale#path:/maid-atelier` and npm tarballs that already contain `lib/` both fail this way. Master has no desktop lock, so `pnpm dsh plugin` there still forwards to pnpm.

## Decision

After applying packaged `$DSH_HOME`, `lib/packaged-web-bin.js` inspects extra argv. When the first token is a CLI head (`plugin`, `--profile`, `--help`, `--version`, `--dump-config`, and the short aliases), it rewrites `process.argv` so `lib/bin.js` sees the CLI invocation and dynamically imports that on-disk entry. Worker-script extras still import the script; empty extra argv still boots the GUI; inner web flags such as `--port` still take the desktop or guest-`show` path so a second double-click does not start another web profile. The desktop boot also passes `--no-open`: web-app's Node `--eval` helper would spawn this same exe as a guest about two seconds after owner start. A Chromium launcher that exits within `DESKTOP_WINDOW_HANDOFF_MS` does not forget the GUI, so a guest `show` (or a plugin-install spawn of this exe) focuses the existing `--app=` window instead of opening another. A packaged exe that is not named `node` uses `cmd /c start`, `open`, or `xdg-open` instead of `--eval` against `process.execPath`.

`packagedCliArgv` and `resolvePackagedCliEntry` in `apps/cli/src/packaged-web-entry.ts` own the token test and the `lib/bin.js` path beside the exe. `extraPackagedArgv` first drops launcher slots and the invocation echo a shell spawn preserves (`dsh` after the SEA rewrites argv[0]); [the shell-argv note](2026-08-22-packaged-plugin-shell-argv.md) owns that skip, the PATH prepend, the `dsh` product alias, and `-e` eval.

## Alternatives considered

**Route every extra argv to the CLI.** Rejected because inner web flags such as `--port` currently reach the packaged profile through the desktop boot, and `dsh web` would start a second web server without the tray.

**Provide DSH Desktop's `desktopPnpm` service so the market never spawns `dsh`.** Rejected as a larger host contract; it would not fix a user running `dsh plugin` from a terminal while the GUI is open.

**Keep a separate CUI `dsh.exe` beside `dsh-web.exe`.** Rejected because the shipped folder already uses one launcher as `dsh` on PATH, and the market's fallback is exactly that name.

**Teach the market that guest exit 0 is a failure.** Rejected because the spawn must still run pnpm; detecting the lock would only change the error text.

## Consequences

Plugin Market installs and `dsh plugin --profile web add` against the packaged exe run pnpm in `.config/profiles/<name>` while the GUI stays the owner of the single-instance pipe. `--profile`, help, version, and config dumps also reach the CLI. Double-click and a second GUI start are unchanged, and the packaged desktop no longer opens a second default-browser helper. Tests in `apps/cli/tests/packaged-web-entry.spec.ts` pin CLI heads versus `--port`; `apps/cli/tests/desktop-listen.spec.ts` pins `--no-open`; `packages/bundle/web-app/tests/web-app.spec.ts` pins the OS opener for a product exe.
