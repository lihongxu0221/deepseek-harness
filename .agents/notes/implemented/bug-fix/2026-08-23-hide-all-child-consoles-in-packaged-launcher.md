# Agent Note: Hide every child console in the packaged Web launcher

Status: implemented

English | [中文](2026-08-23-hide-all-child-consoles-in-packaged-launcher.zh.md)

## Problem

The packaged Web desktop (`dsh-web.exe`) is a GUI-subsystem executable with no console of its own, so Windows allocates a fresh visible console for every console-subsystem child spawned without `windowsHide: true`. Harness-owned spawn paths were already covered: [the local subprocess provider](2026-08-20-hide-windows-console-on-local-spawn.md) sets the flag itself, and the launcher hid the plugin market's cmd/pwsh calls. Third-party plugins execute their own code in that process against raw `node:child_process`, and nothing covered them. Installing `dsh-better-sidebar` made its source-control panel pop one empty console per git command (`rev-parse`, `status`, `log`, per-file `diff`) because it spawns git with piped stdio and no window option, and each repackaging reinstalled the pristine package and brought the windows back.

## Decision

The SEA launcher attaches a hidden console on win32, then wraps the whole exported `node:child_process` family — `spawn`, `spawnSync`, `exec`, `execSync`, `execFile`, `execFileSync` — before importing the app entry. When that console is attached, the wrap leaves `windowsHide` unset so CUI grandchildren inherit it; when attachment fails, it injects `windowsHide: true`. The wrap runs before any ESM import creates the builtin facade, so a plugin's later `import { spawn } from 'node:child_process'` binds to the wrapper. Each wrapper normalizes its function's documented arities: args arrays, options objects, and trailing callbacks pass through untouched; an explicit caller-owned `windowsHide` always wins.

`CREATE_NO_WINDOW` also seeds `STARTUPINFO` with `SW_HIDE`, and Chromium-style children honor that show state for their first `--app` window, so the packaged desktop's browser spawn declares `windowsHide: false` explicitly. WinForms hosts reveal their windows through explicit `Show` calls and keep `windowsHide: true`. In-app terminal sessions stay on `node-pty`/ConPTY, which does not route through these exports. The [local subprocess provider](2026-08-20-hide-windows-console-on-local-spawn.md) remains the owner for `ctx.subprocess` spawns; this note owns the raw-module path plugin code takes. [Hidden-console inheritance](2026-09-02-inherit-hidden-console-for-gui-host.md) owns why `CREATE_NO_WINDOW` cannot be the only policy.

## Alternatives considered

**Fix each plugin upstream.** Rejected as whack-a-mole: every current and future plugin re-arms the bug until patched, and users hit it before any fix ships. An upstream `dsh-better-sidebar` fix still lands as defense in depth, not as the guarantee.

**Wrap child_process at the cordis loader level.** Rejected because plugins loaded as native ESM receive frozen builtin namespaces; interception works only on code evaluated before the facade exists, which is exactly what the pre-import launcher position provides.

**Give the host a hidden console so children inherit it** (`AllocConsole` plus hide). Adopted for trees `CREATE_NO_WINDOW` cannot cover — CUI grandchildren and restricted-token children — in [hidden-console inheritance](2026-09-02-inherit-hidden-console-for-gui-host.md). This wrap remains the fallback when AllocConsole does not attach, and restores standard handles so Node's already-opened streams stay non-TTY.

## Consequences

Every plugin child starts console-free on Windows unless its own code explicitly asks otherwise, and repackaging preserves the guarantee because the policy lives in committed launcher source rather than installed `node_modules`. The cost is bounded: the only first-party opt-out is the desktop browser window that must stay visible, and a plugin that genuinely wants a visible console declares `windowsHide: false` in the same call, where code review sees it.

`apps/cli/tests/packaged-web-entry.spec.ts` pins the wrap position before the first ESM import and exercises every documented call shape against recording stand-ins, including args and callback passthrough, explicit `windowsHide` passthrough, and omitting the injected flag when a hidden console is already attached.
