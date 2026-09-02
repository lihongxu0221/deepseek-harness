# Agent Note: 打包 Web 启动器隐藏所有子控制台

Status: implemented

[English](2026-08-23-hide-all-child-consoles-in-packaged-launcher.md) | 中文

## Problem

打包的 Web 桌面（`dsh-web.exe`）是 GUI 子系统可执行文件，自身没有控制台；Windows 会为每个未带 `windowsHide: true` 的控制台子系统子进程分配一个可见的新控制台。Harness 自有的 spawn 路径此前已覆盖：[本地 subprocess provider](2026-08-20-hide-windows-console-on-local-spawn.zh.md) 自行设置该标志，启动器也隐藏了插件市场的 cmd/pwsh 调用。第三方插件在同一进程里运行自己的代码、直接调用裸 `node:child_process`，没有任何机制覆盖它们。安装 `dsh-better-sidebar` 后，其源代码管理面板每条 git 命令（`rev-parse`、`status`、`log`、逐文件的 `diff`）都会弹出一个空控制台——它以管道 stdio 且不带窗口选项的方式 spawn git，而每次重新打包都会重装原始包，把弹窗带了回来。

## Decision

SEA 启动器在 win32 上先附着一个隐藏控制台，再包装整个 `node:child_process` 导出家族——`spawn`、`spawnSync`、`exec`、`execSync`、`execFile`、`execFileSync`——然后才导入应用入口。附着成功时，包装器不设置 `windowsHide`，让 CUI 孙进程继承该控制台；附着失败时注入 `windowsHide: true`。包装发生在任何 ESM 导入创建内建门面之前，因此插件随后 `import { spawn } from 'node:child_process'` 绑定的就是包装函数。每个包装器按各自函数的文档化重载归一化实参：args 数组、options 对象与末尾回调原样透传；调用方已显式给出的 `windowsHide` 始终生效。

`CREATE_NO_WINDOW` 同时会把 `STARTUPINFO` 的显示状态置为 `SW_HIDE`，Chromium 系子进程的首个 `--app` 窗口会遵循它——因此打包桌面的浏览器 spawn 显式声明 `windowsHide: false`。WinForms 宿主通过显式 `Show` 调用显示窗口，继续使用 `windowsHide: true`。应用内终端会话继续走 `node-pty`/ConPTY，不经过这些导出。[本地 subprocess provider](2026-08-20-hide-windows-console-on-local-spawn.zh.md) 仍是 `ctx.subprocess` spawn 的属主；插件代码所走的裸模块路径由本文接管。[隐藏控制台继承](2026-09-02-inherit-hidden-console-for-gui-host.zh.md) 说明为何 `CREATE_NO_WINDOW` 不能作为唯一策略。

## Alternatives considered

**逐个在上游修插件。** 否决：这是打地鼠——所有现存与未来插件在被修补前都会重新触发该缺陷，用户会在修复发布前先撞上它。上游 `dsh-better-sidebar` 的修复仍会落地，但定位是纵深防御，而不是保证。

**在 cordis loader 层包装 child_process。** 否决：以原生 ESM 加载的插件拿到的是冻结的内建命名空间；拦截只对门面创建之前求值的代码生效，而这正是导入前启动器位置所能提供的。

**给宿主一个隐藏控制台让子进程继承**（`AllocConsole` 加隐藏）。已在 [隐藏控制台继承](2026-09-02-inherit-hidden-console-for-gui-host.zh.md) 中采纳，用于覆盖 `CREATE_NO_WINDOW` 无法处理的进程树——CUI 孙进程与受限令牌子进程。本包装在 AllocConsole 未附着时仍作为回退，并恢复标准句柄，使 Node 已打开的流保持非 TTY。

## Consequences

除非插件代码自己明确要求，否则 Windows 上的插件子进程不再出现控制台；由于策略位于提交在仓库里的启动器源码而非已安装的 `node_modules`，重新打包即可保留保证。代价有边界：唯一的一方退出点是必须保持可见的桌面浏览器窗口；确实需要可见控制台的插件在同一调用里声明 `windowsHide: false` 即可，代码评审自然覆盖。

`apps/cli/tests/packaged-web-entry.spec.ts` 固定了包装相对首次 ESM 导入的位置，并针对记录替身演练了全部文档化调用形态，包括 args 与回调透传、显式 `windowsHide` 的透传，以及已附着隐藏控制台时不注入该标志。
