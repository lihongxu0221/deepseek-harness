# Agent Note: 打包 Web 启动器隐藏所有子控制台

Status: implemented

[English](2026-08-23-hide-all-child-consoles-in-packaged-launcher.md) | 中文

## Problem

打包的 Web 桌面（`dsh-web.exe`）是 GUI 子系统可执行文件，自身没有控制台；Windows 会为每个未带 `windowsHide: true` 的控制台子系统子进程分配一个可见的新控制台。Harness 自有的 spawn 路径此前已覆盖：[本地 subprocess provider](2026-08-20-hide-windows-console-on-local-spawn.zh.md) 自行设置该标志，启动器也隐藏了插件市场的 cmd/pwsh 调用。第三方插件在同一进程里运行自己的代码、直接调用裸 `node:child_process`，没有任何机制覆盖它们。安装 `dsh-better-sidebar` 后，其源代码管理面板每条 git 命令（`rev-parse`、`status`、`log`、逐文件的 `diff`）都会弹出一个空控制台——它以管道 stdio 且不带窗口选项的方式 spawn git，而每次重新打包都会重装原始包，把弹窗带了回来。

## Decision

SEA 启动器在 win32 上包装整个 `node:child_process` 导出家族——`spawn`、`spawnSync`、`exec`、`execSync`、`execFile`、`execFileSync`——并在导入应用入口之前向每个 options 实参注入 `windowsHide: true`。包装发生在任何 ESM 导入创建内建门面之前，因此插件随后 `import { spawn } from 'node:child_process'` 绑定的就是包装函数。每个包装器按各自函数的文档化重载归一化实参：args 数组、options 对象与末尾回调原样透传，只有 options 对象被附加该标志。

覆盖是无条件的：本产品从不显示 OS 控制台窗口。`CREATE_NO_WINDOW` 只关乎控制台分配，子进程自行创建的图形窗口（对话框、浏览器）不受影响；应用内终端会话继续走 `node-pty`/ConPTY，不经过这些导出。[本地 subprocess provider](2026-08-20-hide-windows-console-on-local-spawn.zh.md) 仍是 `ctx.subprocess` spawn 的属主；插件代码所走的裸模块路径由本文接管。

## Alternatives considered

**逐个在上游修插件。** 否决：这是打地鼠——所有现存与未来插件在被修补前都会重新触发该缺陷，用户会在修复发布前先撞上它。上游 `dsh-better-sidebar` 的修复仍会落地，但定位是纵深防御，而不是保证。

**在 cordis loader 层包装 child_process。** 否决：以原生 ESM 加载的插件拿到的是冻结的内建命名空间；拦截只对门面创建之前求值的代码生效，而这正是导入前启动器位置所能提供的。

**给宿主一个隐藏控制台让子进程继承**（`AllocConsole` 加隐藏）。暂时否决：它需要原生插件来完成一次选项注入即可做到的事，会把 `process.stdout` 变成 TTY，且无法按产品表面划分作用域。只有当这个家族之外的 spawn 路径出现同样的闪窗时再重新评估。

## Consequences

无论代码如何，Windows 上每个插件子进程都不再出现控制台；由于策略位于提交在仓库里的启动器源码而非已安装的 `node_modules`，重新打包即可保留保证。代价是有意的：插件无法通过 `windowsHide: false` 退出隐藏；今天没有产品表面需要它，将来若要引入退出通道，应当是一个经过评审的 config 字段，而不是按次调用的标志。

`apps/cli/tests/packaged-web-entry.spec.ts` 固定了包装相对首次 ESM 导入的位置，并针对记录替身演练了全部文档化调用形态，包括 args 与回调透传。
