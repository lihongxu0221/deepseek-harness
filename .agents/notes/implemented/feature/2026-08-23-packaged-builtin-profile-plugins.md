# Agent Note: Seed builtin community plugins into the packaged web profile

Status: implemented

English | [中文](2026-08-23-packaged-builtin-profile-plugins.zh.md)

## Problem

A packaged desktop folder ships without `.config`. First launch therefore boots the bare `base + web-app` composition. The Plugin Market and other community UI plugins stay uninstalled until someone installs them through the market itself, so a double-click product is missing the plugins the winexe build is meant to include.

## Decision

`scripts/build-builtin-profile-plugins.ts` seeds `.config/profiles/web` after the staging deploy. Pins live in `scripts/builtin-profile-plugins.json` as exact semver versions. Missing bundle entries are appended; a present-but-different dependency spec stays user-owned unless `--refresh`. An already-satisfied profile is a no-op and skips pnpm. `allowBuilds` is appended to the profile `pnpm-workspace.yaml` so native install scripts the pins need (node-pty, ssh2, cloudflared, cpu-features) are not blocked. After `initProfile`, the seeder re-reads the manifest so the merge keeps the skeleton's `name` and `private` flag. An existing product folder's preserved `.config` still wins over a fresh seed.

## Alternatives considered

**Install the plugins into the product `node_modules` instead of the profile.** Rejected: out-of-tree plugins belong in the profile's own `node_modules`, the same place `dsh plugin --profile web add` writes.

**Re-pin every rebuild.** Rejected: that would overwrite a user's chosen version on every `build-web-exe`. Append-only plus optional `--refresh` keeps rebuilds additive.

**Leave first launch empty and document a market install.** Rejected: a double-click product that requires a second install step is not the packaged default.

## Consequences

A newly packed folder boots with the pinned plugins already resolvable. The winexe zip copies that seeded `profiles/web` tree and omits the rest of `.config`, so a published folder does not carry the builder's sessions or credentials. `scripts/build-builtin-profile-plugins.spec.ts` pins merge, first-seed identity, allowBuilds append, dry-run, and no-op. The packaged-desktop README records the seed.
