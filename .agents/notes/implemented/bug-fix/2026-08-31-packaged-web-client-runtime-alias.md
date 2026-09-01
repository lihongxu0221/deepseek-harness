# Agent Note: Packaged web seeds the deleted Runtime specifier onto client-store

Status: implemented

English | [中文](2026-08-31-packaged-web-client-runtime-alias.zh.md)

## Problem

Seeded `@linxin666/dsh-web-ui-all@0.2.9` client plugins still `require("@deepseek-ai/dsh-client-runtime/client")`. That package was removed when Runtime split into `dsh-client-store` and feature packages. The module table has no such seed word and no graph row, so materializing `@linxin666/dsh-client-ui-web-ui-settings` fail-louds with `missed the module table` after Host Connection has already authenticated. The only Runtime exports those pins call are `createSnapshotStore` and `defineStore`, which now live on `@deepseek-ai/dsh-client-store`.

## Decision

`getStaticModules()` aliases `@deepseek-ai/dsh-client-runtime` and `@deepseek-ai/dsh-client-runtime/client` to the existing `dsh-client-store` seed. Seed matching is exact, so both the package name and the `/client` subpath are required. Those keys stay out of `PLATFORM_MODULES`: first-party bundles must not treat the deleted specifier as baseline.

## Alternatives considered

**Disable every seeded row that still requires Runtime.** Rejected: that would drop settings, pet, doctor, and other pins that only need the store helpers. Host-side `apiProxy` injectors stay disabled separately.

**Restore the Runtime package.** Rejected: the package was removed on purpose; the live calls are store helpers.

**Add the specifier to `PLATFORM_MODULES`.** Rejected: that would make first-party tsdown treat a deleted name as an implicit external.

## Consequences

Packaged desktop can materialize the remaining seeded UI plugins that still require the old specifier. Plugins that later import other deleted Runtime exports will still miss the table. `packages/client/web/tests/seed.client.spec.ts` pins the alias onto `createSnapshotStore` and `defineStore`.
