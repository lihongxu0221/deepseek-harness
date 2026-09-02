# Agent Note: Hide Windows consoles for local subprocess spawns

Status: implemented

English | [中文](2026-08-20-hide-windows-console-on-local-spawn.zh.md)

## Problem

The packaged Web desktop is a GUI-subsystem executable. A GUI host that starts a console-subsystem child without `CREATE_NO_WINDOW` gets a new visible console for that child. Session work repeatedly spawns the packaged ripgrep binary (`@vscode/ripgrep`, typically `rg.exe`) through `ctx.subprocess`, and the same local provider also runs `taskkill` during teardown. Without `windowsHide`, each of those children shows a CMD window for the lifetime of the process.

The public subprocess spec does not carry a window-visibility flag. Visibility is a Windows host property of the local spawn, not a consumer choice, so patching `glob`/`grep` or the desktop launcher would leave pwsh, LSP, and other local children flashing the same window.

## Decision

`dsh-subprocess-local` passes `windowsHide: true` to Node `spawn` / `spawnSync` only when this process has no console. Node maps that option to `CREATE_NO_WINDOW`. Ordinary trees, including packaged `rg.exe` and pwsh, and the local `taskkill /T` helpers in `spawn.ts` and `windows-inspector.ts`, all take this path. When the parent already owns a console — including the hidden console a GUI host attaches — spawn omits the flag so CUI grandchildren inherit that console; see [hidden-console inheritance](2026-09-02-inherit-hidden-console-for-gui-host.md).

Node ignores the flag off Windows. Piped and collected stdio stay pipes; `inherit` still uses the parent descriptors. Terminal sessions stay on `node-pty` / ConPTY and do not use this flag.

Windows ACL sandbox children remain a separate native spawn that still omits `CREATE_NO_WINDOW`, because a restricted token dies with `STATUS_DLL_INIT_FAILED` under that flag; see [the Windows ACL sandbox decision](../feature/2026-08-08-windows-acl-restricted-token-sandbox.md). The packaged launcher separately wraps raw `node:child_process` exports so third-party-plugin children follow the same hide-or-inherit rule; see [the packaged-launcher child-console decision](2026-08-23-hide-all-child-consoles-in-packaged-launcher.md).

## Verification

Unit tests record the Node spawn options for an ordinary child and for `taskkillProcessTree`, require `windowsHide: true` when the parent has no console, and require `windowsHide: false` on spawn when the parent already owns a console. Existing collect, inherit, abort, and Windows taskkill lifecycle tests continue to pin stdio and teardown.

## Alternatives considered

**Set `windowsHide` only in `dsh-tool-fs-search`.** Rejected because every local console child of a GUI host has the same flash, including pwsh and teardown `taskkill`. The local provider is the one spawn all of those callers share.

**Add a `windowsHide` field to `SubprocessSpawnSpec`.** Rejected because no current consumer needs a visible extra console, and a per-call flag would reintroduce the flash wherever a caller forgot it.

**Keep the host as a CUI executable.** Rejected because Explorer would then open a persistent console for the desktop itself; the [Windows splash and tray host](../feature/2026-08-19-windows-packaged-desktop-tray.md) already marks the launcher GUI.

**Use `detached: true` on Windows to hide the console.** Rejected because a detached Windows child can still allocate a console, and the local provider already keeps Windows trees attached so `taskkill /T` can address the root pid.

## Consequences

A GUI-subsystem host no longer flashes a console per direct local child. Consumers do not opt in. A future caller that needs a visible extra console must change the local provider, not a single tool. Restricted-token sandbox children still share the host console when that sandbox is active.
