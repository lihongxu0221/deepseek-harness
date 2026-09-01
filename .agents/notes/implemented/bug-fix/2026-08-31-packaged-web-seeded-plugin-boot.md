# Agent Note: Seeded community plugins must still boot the packaged web profile

Status: implemented

English | [中文](2026-08-31-packaged-web-seeded-plugin-boot.zh.md)

## Problem

`build-web-exe` seeds `dshmarket` and `@linxin666/dsh-web-ui-all` into `.config/profiles/web`. Those packages import `settingsNamespace` and `installSettingsSection` from `@deepseek-ai/dsh-settings`, and `@linxin666/dsh-remote-web-ui` imports `RpcId` from `@deepseek-ai/dsh-host-apiproxy/api/rpc`. Master folded the settings helpers into `SettingsProvider` methods and deleted API Proxy. One missing export or specifier fail-louds the whole web profile, so the packaged desktop tray stays up with no listen port. `desktop-host.log` recorded only the single-instance lock. After those names resolve, `@linxin666/dsh-remote-web-ui` and `@linxin666/dsh-client-ui-task-board` still inject `apiProxy`, and Loader leaves the whole tree pending.

## Decision

Re-export `settingsNamespace` and `installSettingsSection` from `@deepseek-ai/dsh-settings`. They brand a namespace and call `SettingsProvider.installSection`; they are not a second settings seam. `healHostApiproxyRpcStub` writes a private `RpcId` identity helper under `$DSH_HOME/profiles/node_modules/@deepseek-ai/dsh-host-apiproxy/api/rpc.js`. The stub is not API Proxy. `prepareProfile` and `dsh plugin` run the heal; an existing package is left untouched. Packaged desktop boot failures also append to `desktop-host.log`. `resolveApiproxyDependentDisablePatches` then disables the seeded `web-ui-task-board` / `web-ui-remote-web-ui` rows (and the standalone `ui-task-board` / `remote-web-ui` ids) after user and `--patch` layers. The remaining seeded UI plugins still mount.

## Alternatives considered

**Drop the seeded plugins until they target current exports.** Rejected: the packaged default is supposed to boot with those pins already installed. Disabling only the two `apiProxy` injectors keeps the rest of the pin list.

**Restore the API Proxy package.** Rejected: the only live import that a stub can satisfy is `RpcId`, and the package was removed on purpose. A compatibility `ctx.apiProxy` would restore the deleted service.

**Fail-soft a missing community plugin instead of fail-loud.** Rejected: Loader fail-loud is the profile contract; the missing names are ours to keep.

## Consequences

A packaged folder that still seeds those pins can compose the web profile. Remote-control and task-board host plugins stay unmounted until they stop injecting `apiProxy`. Community plugins that later stop importing the old names are unaffected. After Host composition, those pins still `require` the deleted Runtime specifier; [the client-store alias](2026-08-31-packaged-web-client-runtime-alias.md) answers that table miss. `packages/settings/settings/tests/settings.spec.ts` pins the re-exports. `packages/boot/app-boot/tests/profile.spec.ts` pins the stub write and the leave-existing-package rule. `apps/cli/tests/telemetry-switch.spec.ts` pins the disable overlay.
