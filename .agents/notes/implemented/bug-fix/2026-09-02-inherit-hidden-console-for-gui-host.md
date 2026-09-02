# Agent Note: GUI hosts inherit a hidden console instead of CREATE_NO_WINDOW for process trees

Status: implemented

English | [中文](2026-09-02-inherit-hidden-console-for-gui-host.zh.md)

## Problem

The packaged Web desktop is a GUI-subsystem executable with no console. Direct CUI children without `CREATE_NO_WINDOW` allocate a visible empty console even when stdio is piped. [Local spawn](2026-08-20-hide-windows-console-on-local-spawn.md) and the [launcher wrap](2026-08-23-hide-all-child-consoles-in-packaged-launcher.md) hide those direct children, but `CREATE_NO_WINDOW` also disconnects them from any console. A later CUI grandchild — pwsh spawning git, node, or another console program during an agent turn — then allocates a new visible empty window. Restricted-token sandbox children cannot use `CREATE_NO_WINDOW` at all (`STATUS_DLL_INIT_FAILED`); a GUI runner therefore flashes one empty console per confined command.

## Decision

A GUI host attaches a hidden console and lets CUI descendants inherit it. The packaged launcher calls `AllocConsole`, hides the new window, and restores stdin/stdout/stderr so Node's already-opened streams stay non-TTY and piped runner stdio is not stolen. The Windows ACL runner calls the same helper before `CreateProcessAsUserW`, because a GUI child does not inherit its parent's console. `dsh-subprocess-local` and the launcher `child_process` wrap pass `windowsHide` only when this process still has no console; an explicit caller-owned `windowsHide` still wins, including the desktop browser's `false`.

`attachHiddenConsole()` in `@deepseek-ai/dsh-win32-process` owns the native sequence. If this process already has a console, the helper returns without hiding it, so a CUI `node` test runner keeps its terminal.

## Verification

Win32-process unit tests inject the kernel32/user32 table and require that an existing console is left alone, a failed `AllocConsole` does not restore handles, and a successful attach hides the window and restores the three standard handles. Local spawn tests require `windowsHide: true` without a parent console and `windowsHide: false` with one. Launcher tests evaluate the wrap with both attach outcomes, including omitting the injected flag when a hidden console is already attached.

## Alternatives considered

**Keep unconditional `CREATE_NO_WINDOW` on every direct child.** Rejected because it is exactly the grandchild flash: the hidden pwsh has no console for git to inherit.

**Use `DETACHED_PROCESS` on restricted-token children.** Rejected as the sole policy because a detached CUI parent still leaves its grandchildren without a console to inherit, and `CREATE_NO_WINDOW` / `CREATE_NEW_CONSOLE` already die under the restricted token.

**AllocConsole on the GUI host only.** Rejected as sufficient by itself: a GUI `dsh-web.exe` runner is a separate process and does not attach to the host console, so confined children would still flash unless the runner attaches too.

## Consequences

Agent turns that spawn pwsh, then git or another CUI program, no longer pop an empty console on the packaged desktop. Confined sandbox commands inherit the runner's hidden console instead of allocating one. The cost is a hidden console object on each packaged GUI process; stdio restoration keeps logging and runner pipes unchanged. `node-pty` / ConPTY sessions remain outside this path.
