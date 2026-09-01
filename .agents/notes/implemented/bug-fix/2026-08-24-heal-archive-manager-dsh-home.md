# Agent Note: Honor DSH_HOME in the shipped archive-manager host

Status: implemented

English | [中文](2026-08-24-heal-archive-manager-dsh-home.zh.md)

## Problem

`@mlgbnb/dsh-archive-manager` ships a host `dshHome()` that returns `join(homedir(), '.dsh')` and never reads `$DSH_HOME`. The packaged desktop stores sessions and `storages/workspace.json` under `<product>/.config`. The settings card therefore lists an empty archive against `~/.dsh`. Replacing the export after import cannot fix this: ESM keeps the internal `dshHome()` call as a local binding.

## Decision

`healArchiveManagerHome` rewrites that host file in the profile `node_modules` before Cordis imports it. The only change is `return process.env.DSH_HOME ?? join(homedir(), '.dsh')`. `prepareProfile` runs it on every boot; `dsh plugin` runs it after a successful install so a later market add is healed before the next start. A missing package, a host that already mentions `process.env.DSH_HOME`, or a write failure is a no-op so start still proceeds.

This does not replace [`resolveDshHome`](../architecture/2026-07-24-single-harness-home-resolver.md). The third-party file cannot import `@deepseek-ai/dsh-home-paths`; the process environment is the same home the packaged launcher already sets.

## Alternatives considered

**Patch the npm package and wait for a release.** Rejected as the only fix: 1.0.7 is current, and every existing unzip keeps the hardcoded home until someone reinstalls.

**Monkey-patch the exported `dshHome` after import.** Rejected: same-module calls do not see a reassigned export.

**Junction `~/.dsh` onto `<product>/.config`.** Rejected: a CLI install that already uses `~/.dsh` would share or collide with the desktop home.

## Consequences

A packaged or relocated folder lists archives from `$DSH_HOME` after one start, including zips that still contain the published host. An upstream release that already honors `$DSH_HOME` is left untouched. `packages/boot/app-boot/tests/profile.spec.ts` pins the rewrite, the double-quoted form, idempotence, and the absent-file no-op.
