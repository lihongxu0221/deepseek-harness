# Agent Note: 打包形态导入 worker 时脚本路径留在 argv.slice(2)

Status: implemented

[English](2026-08-23-packaged-worker-script-argv.md) | 中文

## Problem

Windows ACL sandbox runner 的拉起方式是 `spawn(process.execPath, [runner.js, '--workspace', …])`。打包桌面上 `process.execPath` 是 `dsh-web.exe`。SEA 子进程在进程内导入 `runner.js`。pkg SEA 的 argv 是 `[exe, exe-or-echo, runner.js, --workspace, …]`。runner（master 上的文件）解析 `process.argv.slice(2)`，于是第一个 token 就是 `runner.js`。它打印 `windows-acl-run: unknown argument: …\\runner.js` 并以 127 退出。shell 消费方随后报告 `workspace-write` 没有可用的 sandbox 后端。

[CLI 头路径](2026-08-20-packaged-desktop-plugin-cli.zh.md)在导入 `lib/bin.js` 前已经改写 argv。[打包 exe](../feature/2026-08-18-packaged-web-desktop-exe.zh.md) 给 `spawn(process.execPath, [worker])` 用的 worker 导入路径没有改写。[shell argv 跳过](2026-08-22-packaged-plugin-shell-argv.zh.md)在选择脚本时已经去掉调用回声，但没有把剩余参数收成 Node 的 `[exe, script, …args]` 布局。

## Decision

`apps/cli/src/packaged-web-entry.ts` 的 `withPackagedScriptArgv` 构造 `[execPath, script, ...extra.slice(1)]`。`packaged-web-bin.ts` 与 `packaged-web-launcher.cjs` 在导入 worker 前把它赋给 `process.argv`。GUI 启动和 CLI 头分发不变。master 上的 sandbox 文件不变：runner 继续用 `slice(2)`，后续合入 master 不必改 `parseArgs`。

## Alternatives considered

**让 `sandbox-windows-acl/runner.ts` 的 `parseArgs` 跳过前导脚本路径。** 否决：该文件在 master 上；本分支对 master 已有文件只追加方法，不改已有方法名或参数名。打包侧改写 argv 也能修好所有使用 `slice(2)` 的 worker。

**把 `windowsAclRunnerInvocation` 改成真正的 `node.exe`。** 否决：打包宿主已经宣称自己充当 node，好让助手留在随附 ABI 上。PATH 上的 node 可能加载不了随附的 koffi addon。

**让 runner 继续失败，要求 `danger-full-access`。** 否决：打包默认就是 `workspace-write`。

## Consequences

打包形态的 `workspace-write` 禁闭可以启动 ACL runner。`apps/cli/tests/packaged-web-entry.spec.ts` 固定了 `withPackagedScriptArgv` 和启动器改写。打包桌面 README 记录了这份 argv 布局。
