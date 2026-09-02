# Agent Note: GUI 宿主通过继承隐藏控制台，而不是对整棵进程树使用 CREATE_NO_WINDOW

Status: implemented

[English](2026-09-02-inherit-hidden-console-for-gui-host.md) | 中文

## Problem

打包的 Web 桌面是没有控制台的 GUI 子系统可执行文件。直接的 CUI 子进程若没有 `CREATE_NO_WINDOW`，即使 stdio 已接到管道，也会分配一个可见的空控制台。[本地 spawn](2026-08-20-hide-windows-console-on-local-spawn.zh.md) 与[启动器包装](2026-08-23-hide-all-child-consoles-in-packaged-launcher.zh.md)能隐藏这些直接子进程，但 `CREATE_NO_WINDOW` 也会把它们从任何控制台断开。之后的 CUI 孙进程——代理回合中 pwsh 再拉起 git、node 或其他控制台程序——就会再分配一个可见的空窗口。受限令牌沙箱子进程根本不能使用 `CREATE_NO_WINDOW`（`STATUS_DLL_INIT_FAILED`）；GUI runner 因此会为每条受限命令弹出一个空控制台。

## Decision

GUI 宿主附着一个隐藏控制台，并让 CUI 后代继承它。打包启动器调用 `AllocConsole`，隐藏新窗口，并恢复 stdin/stdout/stderr，使 Node 已打开的流保持非 TTY，也不会偷走 runner 的管道 stdio。Windows ACL runner 在 `CreateProcessAsUserW` 之前调用同一辅助函数，因为 GUI 子进程不会继承父进程控制台。`dsh-subprocess-local` 与启动器的 `child_process` 包装仅在本进程仍没有控制台时传入 `windowsHide`；调用方显式给出的 `windowsHide` 始终生效，包括桌面浏览器的 `false`。

`@deepseek-ai/dsh-win32-process` 中的 `attachHiddenConsole()` 拥有这段原生序列。若本进程已有控制台，辅助函数直接返回且不隐藏它，因此 CUI 的 `node` 测试运行器会保留其终端。

## Verification

Win32-process 单元测试注入 kernel32/user32 表，并要求已有控制台保持不动、失败的 `AllocConsole` 不恢复句柄、成功附着会隐藏窗口并恢复三个标准句柄。本地 spawn 测试在没有父控制台时要求 `windowsHide: true`，有父控制台时要求 `windowsHide: false`。启动器测试对两种附着结果都求值包装器，包括已附着隐藏控制台时不注入该标志。

## Alternatives considered

**继续对每个直接子进程无条件使用 `CREATE_NO_WINDOW`。** 否决，因为这正是孙进程闪窗：被隐藏的 pwsh 没有可供 git 继承的控制台。

**对受限令牌子进程使用 `DETACHED_PROCESS`。** 否决作为唯一策略，因为 detached 的 CUI 父进程仍不会给孙进程留下可继承的控制台，而且 `CREATE_NO_WINDOW` / `CREATE_NEW_CONSOLE` 在受限令牌下已经会死亡。

**只在 GUI 宿主上 AllocConsole。** 否决作为单独足够的方案：GUI 的 `dsh-web.exe` runner 是另一进程，不会附着到宿主控制台，因此除非 runner 自己也附着，受限子进程仍会闪窗。

## Consequences

在打包桌面上，代理回合先 spawn pwsh 再拉起 git 或其他 CUI 程序时，不再弹出空控制台。受限沙箱命令继承 runner 的隐藏控制台，而不是再分配一个。代价是每个打包 GUI 进程多一个隐藏控制台对象；恢复 stdio 后日志与 runner 管道保持不变。`node-pty` / ConPTY 会话仍在这条路径之外。
