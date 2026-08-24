# Agent Note: Keep profile storeDir aligned with the current pnpm store

Status: implemented

English | [中文](2026-08-23-profile-storedir-current-pnpm-store.zh.md)

## Problem

pnpm refuses to install into a `node_modules` whose `.modules.yaml` `storeDir` is missing or differs from the store it is about to use (`ERR_PNPM_UNEXPECTED_STORE`). The check is `if (!modules.storeDir || path.relative(...) !== '')`. A shipped web profile therefore cannot run `dsh plugin update` after the portable-layout heal deletes `storeDir`, because the recorded store becomes `undefined`. Writing `virtualStoreDir: node_modules/.pnpm` into `.modules.yaml` is a second mismatch: pnpm joins that field onto `node_modules`, so it reads `node_modules/node_modules/.pnpm` and raises `ERR_PNPM_UNEXPECTED_VIRTUAL_STORE`.

## Decision

`healProfileVirtualStoreDir` does not delete `storeDir`. `dsh plugin` probes `pnpm store path` in the profile directory and passes that path so heal can write it before the forwarded `pnpm` command. Boot still rewrites only the portable `virtualStoreDir`. That yaml field is joined onto `node_modules`, so heal writes `.pnpm` rather than the npmrc value `node_modules/.pnpm`. Heal parses JSON or YAML because pnpm writes YAML after a successful install.

This is the store half of the portable-layout work in [packaged builtin profile plugins](../feature/2026-08-23-packaged-builtin-profile-plugins.md).

## Alternatives considered

**Pin a profile-local `store-dir` in `.npmrc`.** Rejected: it forks the user's store and still needs the versioned suffix (`v10`/`v11`) that only the running pnpm knows.

**Leave `storeDir` deleted and tell the user to `pnpm install`.** Rejected: that is the error's recovery text, not a product path; Plugin Market update would keep failing.

**Delete `node_modules` and reinstall on every store mismatch.** Rejected: the packaged profile already has a hoisted tree; wiping it on update is slow and drops user-installed plugins if install fails mid-way.

## Consequences

A moved or shipped folder can update plugins on the machine's current store. Boot does not spawn pnpm. A manual `pnpm add` inside the profile without `dsh plugin` can still see a stale packer `storeDir` until the next `dsh plugin` heal.
