# Agent Note: Packaged Web exe owns Job-runner and Plugin Market CLI dispatch

Status: implemented

English | [中文](2026-09-16-packaged-web-job-runner-and-plugin-cli.zh.md)

## Problem

The packaged Windows Web executable is one file with three jobs: the GUI host, `dsh plugin` / `--profile` CLI, and the private Windows Job runner. Ordinary Windows spawns from a `pkg` process relaunch that same executable with `DSH_SUBPROCESS_RUNNER=windows` and target argv after a private `--`. Plugin Market `dshArgv()` only treats `argv[1]` matching `bin.js`, `bin.ts`, or a `dsh` stem as this CLI and otherwise runs PATH `dsh`. A child that boots the GUI instead claims the single-instance lock as guest and exits 0 without IPC and without writing the profile, so the parent reports a clean Job-runner failure or a successful install that did not change `package.json`.

## Decision

**The SEA launcher is the Job-runner bootstrap.** When `DSH_SUBPROCESS_RUNNER` is set, `packaged-web-launcher.cjs` skips `AllocConsole`, skips the GUI, resolves `@deepseek-ai/dsh-subprocess-local/runner` beside the exe, rewrites `process.argv` so `slice(2)` starts at the private `--`, and calls `runSelectedSubprocessRunner`. A missing runner export or resolve failure exits 127 rather than falling through to the GUI.

**The GUI boot rewrites argv for Plugin Market before mounting the web profile.** `withPackagedMarketCliArgv` points `argv[1]` at on-disk `lib/bin.js`. Market then spawn()s this executable with the CLI entry, which keeps `DSH_HOME` at `<exeDir>/.config` and runs `dsh plugin` instead of a second GUI instance or a different harness home on PATH.

CLI heads (`plugin`, `--profile`, help, version, config dumps) still import `lib/bin.js` from extra argv and do not take the desktop lock.

## Alternatives considered

**Pass the runner.js path as a packaged script argument instead of an env selector.** The launcher already imports a first extra `.js` argument, but a dynamic `import()` from the SEA file is not `import.meta.main`, so the runner module would load and not run. The env selector is the `pkg` contract `spawnRunnerInvocation` already uses.

**Keep PATH `dsh` as the Market install channel.** A sibling `dsh.exe` can work when it is this same packaged file. PATH also finds a global or checkout `dsh` that writes a different home, or a GUI guest that exits 0. Rewriting argv makes the in-process spawn name `lib/bin.js` on this executable.

**Disable the Windows Job runner inside the packaged GUI and use fallback `spawnSubprocess`.** That avoids the missing bootstrap, and also drops Job containment for every ordinary command the desktop host runs.

## Consequences

Packaged Job-runner children no longer attach a hidden console or take the GUI guest path. Plugin Market installs run `lib/bin.js` against the portable `.config` profile. The SEA embed must include the updated launcher; on-disk `lib/packaged-web-bin.js` alone cannot skip `AllocConsole` in an old exe. `apps/cli/tests/packaged-web-entry.spec.ts` pins the launcher env check before `attachHiddenConsole` and the GUI `withPackagedMarketCliArgv` call.
