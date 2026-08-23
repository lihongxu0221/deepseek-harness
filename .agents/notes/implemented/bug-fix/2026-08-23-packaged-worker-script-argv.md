# Agent Note: Packaged worker import left the script path in argv.slice(2)

Status: implemented

English | [中文](2026-08-23-packaged-worker-script-argv.zh.md)

## Problem

The Windows ACL sandbox runner is spawned as `spawn(process.execPath, [runner.js, '--workspace', …])`. On the packaged desktop, `process.execPath` is `dsh-web.exe`. The SEA child imports `runner.js` in-process. pkg SEA argv is `[exe, exe-or-echo, runner.js, --workspace, …]`. The runner (a master file) parses `process.argv.slice(2)`, so the first token is `runner.js`. It prints `windows-acl-run: unknown argument: …\\runner.js` and exits 127. The shell consumer then reports that no sandbox backend is usable for `workspace-write`.

The [CLI-head path](2026-08-20-packaged-desktop-plugin-cli.md) already rewrites argv before importing `lib/bin.js`. The worker-import path that [the packaged exe](../feature/2026-08-18-packaged-web-desktop-exe.md) uses for `spawn(process.execPath, [worker])` did not. [The shell-argv skip](2026-08-22-packaged-plugin-shell-argv.md) already strips the invocation echo when choosing the script; it did not put the remaining flags into Node's `[exe, script, …args]` layout.

## Decision

`withPackagedScriptArgv` in `apps/cli/src/packaged-web-entry.ts` builds `[execPath, script, ...extra.slice(1)]`. `packaged-web-bin.ts` and `packaged-web-launcher.cjs` assign that to `process.argv` before importing the worker. GUI boot and CLI-head dispatch are unchanged. Master sandbox files are unchanged: the runner keeps `slice(2)`, and later master merges do not need a `parseArgs` change.

## Alternatives considered

**Teach `parseArgs` in `sandbox-windows-acl/runner.ts` to skip a leading script path.** Rejected: that file is on master; this branch only adds methods to master-owned files and must not rename or reshape existing ones. A packaged-only argv rewrite also fixes every other worker that uses `slice(2)`.

**Change `windowsAclRunnerInvocation` to a real `node.exe`.** Rejected: the packaged host already claims to act as node so helpers stay on the bundled ABI. A PATH node may not load the shipped koffi addon.

**Leave the runner failing and require `danger-full-access`.** Rejected: `workspace-write` is the packaged default.

## Consequences

Packaged `workspace-write` confinement can start the ACL runner. `apps/cli/tests/packaged-web-entry.spec.ts` pins `withPackagedScriptArgv` and the launcher rewrite. The packaged-desktop README records the argv layout.
