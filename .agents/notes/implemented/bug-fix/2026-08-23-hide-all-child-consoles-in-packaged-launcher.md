# Agent Note: Hide every child console in the packaged Web launcher

Status: implemented

English | [中文](2026-08-23-hide-all-child-consoles-in-packaged-launcher.zh.md)

## Problem

The packaged Web desktop (`dsh-web.exe`) is a GUI-subsystem executable with no console of its own, so Windows allocates a fresh visible console for every console-subsystem child spawned without `windowsHide: true`. Harness-owned spawn paths were already covered: [the local subprocess provider](2026-08-20-hide-windows-console-on-local-spawn.md) sets the flag itself, and the launcher hid the plugin market's cmd/pwsh calls. Third-party plugins execute their own code in that process against raw `node:child_process`, and nothing covered them. Installing `dsh-better-sidebar` made its source-control panel pop one empty console per git command (`rev-parse`, `status`, `log`, per-file `diff`) because it spawns git with piped stdio and no window option, and each repackaging reinstalled the pristine package and brought the windows back.

## Decision

The SEA launcher wraps the whole exported `node:child_process` family on win32 — `spawn`, `spawnSync`, `exec`, `execSync`, `execFile`, `execFileSync` — and injects `windowsHide: true` into every options argument before importing the app entry. The wrap runs before any ESM import creates the builtin facade, so a plugin's later `import { spawn } from 'node:child_process'` binds to the wrapper. Each wrapper normalizes its function's documented arities: args arrays, options objects, and trailing callbacks pass through untouched; only the options object gains the flag.

The override is unconditional. This product never shows an OS console window. `CREATE_NO_WINDOW` concerns console allocation only, so GUI windows children create for themselves — dialogs, browsers — are unaffected, and in-app terminal sessions stay on `node-pty`/ConPTY, which does not route through these exports. The [local subprocess provider](2026-08-20-hide-windows-console-on-local-spawn.md) remains the owner for `ctx.subprocess` spawns; this note owns the raw-module path plugin code takes.

## Alternatives considered

**Fix each plugin upstream.** Rejected as whack-a-mole: every current and future plugin re-arms the bug until patched, and users hit it before any fix ships. An upstream `dsh-better-sidebar` fix still lands as defense in depth, not as the guarantee.

**Wrap child_process at the cordis loader level.** Rejected because plugins loaded as native ESM receive frozen builtin namespaces; interception works only on code evaluated before the facade exists, which is exactly what the pre-import launcher position provides.

**Give the host a hidden console so children inherit it** (`AllocConsole` plus hide). Rejected for now: it needs a native addon where an option injection suffices, turns `process.stdout` into a TTY, and cannot be scoped per product surface. Revisit only if a spawn path outside this family shows the same flash.

## Consequences

Every plugin child starts console-free on Windows regardless of its code, and repackaging preserves the guarantee because the policy lives in committed launcher source rather than installed `node_modules`. The cost is deliberate: a plugin cannot opt out through `windowsHide: false`; no product surface wants that today, and reintroducing an escape hatch means a reviewed config field, not a per-callsite flag.

`apps/cli/tests/packaged-web-entry.spec.ts` pins the wrap position before the first ESM import and exercises every documented call shape against recording stand-ins, including args and callback passthrough.
