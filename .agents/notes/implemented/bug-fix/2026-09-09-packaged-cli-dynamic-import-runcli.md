# Agent Note: Packaged plugin install must call `runCli()` after dynamic import

Status: implemented

English | [中文](2026-09-09-packaged-cli-dynamic-import-runcli.zh.md)

## Problem

Plugin Market install on the packaged Windows Web exe reported success (`exit=0`, empty stderr) while the profile `package.json` did not change. The market's own check then said the install channel never ran.

The GUI process rewrites `argv[1]` to on-disk `lib/bin.js` so Plugin Market's `dshArgv()` spawn()s this executable with that path instead of PATH `dsh`. The child SEA still boots `packaged-web-launcher.cjs` as the process entry and dynamically imports `lib/bin.js`. `lib/bin.js` only self-executes behind `if (import.meta.main)`. Dynamic import never sets that flag, so `runCli()` did not run, the process had no work, and it exited 0.

Measured on a live packaged home: `dsh-agy-link` / `dsh-cost-meter` installs logged `exit=0 err=` with no `desktop-host.log` guest line, which is the empty-import path rather than the single-instance GUI guest path (that guest always logs `role=guest`).

## Decision

`runImportedPackagedCli` in `apps/cli/src/packaged-web-entry.ts` rewrites `process.argv` to `[execPath, lib/bin.js, ...cli]` and **calls the exported `runCli()`**. The packaged Web entry uses that helper for CLI heads. The SEA launcher also calls `runCli()` when the module it imported exports it, so a spawn that treats `lib/bin.js` as a worker script still executes the CLI.

Rewriting GUI `argv[1]` to `lib/bin.js` so Plugin Market spawn()s this executable remains required. It is not sufficient: the importer must invoke `runCli()`.

## Alternatives considered

**Rely on `import.meta.main` after rewriting argv.** The SEA launcher is always the process entry. No amount of argv rewriting makes a dynamically imported `lib/bin.js` the main module.

**Spawn a second Node to run `lib/bin.js` as main.** The packaged desktop embeds Node in the GUI exe; there is no separate `node` on PATH. Spawning this same exe is the Node.

**Treat empty `runCli` as failure and exit 1.** That would stop the false success, but still would not install the plugin.

**Change Plugin Market to avoid `dshArgv()`.** The market is an out-of-tree plugin. The packaged host owns making `dsh plugin` work when that plugin re-invokes this executable.

## Consequences

- Plugin Market `dsh plugin --profile web add <pkg>` from the packaged GUI runs pnpm in `.config/profiles/web` instead of exiting 0 with no profile change.
- Worker scripts that do not export `runCli` are unchanged: the launcher's extra call is a no-op for `packaged-web-bin.js` and for native helper workers.
- Coverage of the call is the `runImportedPackagedCli` unit tests plus source assertions that the launcher and `packaged-web-bin.ts` invoke it. A full SEA spawn is a packaged-desktop rebuild, not this suite.

## Testing

`apps/cli/tests/packaged-web-entry.spec.ts` asserts `runImportedPackagedCli` rewrites argv and calls `runCli`, refuses a module without that export, and that both importers contain the call.
