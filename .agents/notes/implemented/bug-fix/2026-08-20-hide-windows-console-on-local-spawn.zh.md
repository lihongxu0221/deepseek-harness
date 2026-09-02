# Agent Note: 本地 subprocess spawn 隐藏 Windows 控制台

Status: implemented

[English](2026-08-20-hide-windows-console-on-local-spawn.md) | 中文

## Problem

打包的 Web 桌面是 GUI 子系统可执行文件。GUI 宿主在未设置 `CREATE_NO_WINDOW` 的情况下启动控制台子系统子进程时，Windows 会为该子进程分配一个可见控制台。会话工作会通过 `ctx.subprocess` 反复 spawn 随包提供的 ripgrep 二进制（`@vscode/ripgrep`，通常为 `rg.exe`），同一本地 provider 还会在拆卸时运行 `taskkill`。若不设置 `windowsHide`，每个这类子进程都会在其存活期间弹出一个 CMD 窗口。

公共 subprocess spec 不携带窗口可见性标志。可见性是本地 spawn 的 Windows 宿主属性，而不是消费方选择；只修补 `glob`/`grep` 或桌面启动器，pwsh、LSP 以及其他本地子进程仍会弹出同一类窗口。

## Decision

`dsh-subprocess-local` 仅在本进程没有控制台时向 Node `spawn` / `spawnSync` 传入 `windowsHide: true`。Node 将该选项映射为 `CREATE_NO_WINDOW`。普通进程树（包括随包 `rg.exe` 与 pwsh）以及 `spawn.ts` 与 `windows-inspector.ts` 中的本地 `taskkill /T` 辅助程序都走这条路径。当父进程已经拥有控制台——包括 GUI 宿主附着的隐藏控制台——spawn 省略该标志，让 CUI 孙进程继承该控制台；参见[隐藏控制台继承](2026-09-02-inherit-hidden-console-for-gui-host.zh.md)。

Node 在非 Windows 上忽略该标志。管道与收集式 stdio 仍使用管道；`inherit` 仍使用父进程描述符。终端会话继续走 `node-pty` / ConPTY，不使用该标志。

Windows ACL 沙箱子进程仍是单独的原生 spawn，并且仍然省略 `CREATE_NO_WINDOW`，因为受限令牌在该标志下会以 `STATUS_DLL_INIT_FAILED` 死亡；参见 [Windows ACL 沙箱决策](../feature/2026-08-08-windows-acl-restricted-token-sandbox.zh.md)。打包启动器另行包装了裸 `node:child_process` 导出，让第三方插件的子进程遵循同一套隐藏或继承规则；参见[打包启动器子控制台决策](2026-08-23-hide-all-child-consoles-in-packaged-launcher.zh.md)。

## Verification

单元测试记录普通子进程和 `taskkillProcessTree` 的 Node spawn 选项，在父进程没有控制台时要求 `windowsHide: true`，并在父进程已拥有控制台时要求 spawn 使用 `windowsHide: false`。现有的收集、inherit、abort 以及 Windows taskkill 生命周期测试继续固定 stdio 与拆卸行为。

## Alternatives considered

**只在 `dsh-tool-fs-search` 设置 `windowsHide`。** 拒绝，因为 GUI 宿主的每个本地控制台子进程都会同样闪窗，包括 pwsh 与拆卸时的 `taskkill`。这些调用方共享的唯一 spawn 就是本地 provider。

**向 `SubprocessSpawnSpec` 增加 `windowsHide` 字段。** 拒绝，因为当前没有消费方需要额外的可见控制台；按次标志会在调用方遗漏时重新引入闪窗。

**把宿主保持为 CUI 可执行文件。** 拒绝，因为资源管理器会为桌面本身打开一个持久控制台；[Windows 闪窗与托盘宿主](../feature/2026-08-19-windows-packaged-desktop-tray.zh.md) 已经把启动器标成 GUI。

**在 Windows 上使用 `detached: true` 来隐藏控制台。** 拒绝，因为 detached 的 Windows 子进程仍可能分配控制台，而且本地 provider 已经让 Windows 进程树保持附加，以便 `taskkill /T` 能按根 pid 寻址。

## Consequences

GUI 子系统宿主不再为每个直接本地子进程弹出控制台。消费方无需选择加入。若未来调用方需要额外的可见控制台，必须改本地 provider，而不是单个工具。受限令牌沙箱子进程在该沙箱启用时仍共享宿主控制台。
