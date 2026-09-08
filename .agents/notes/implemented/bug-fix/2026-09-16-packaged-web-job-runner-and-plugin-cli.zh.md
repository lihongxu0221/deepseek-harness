# Agent Note: Packaged Web exe owns Job-runner and Plugin Market CLI dispatch

Status: implemented

[English](2026-09-16-packaged-web-job-runner-and-plugin-cli.md) | 中文

## Problem

打包的 Windows Web 可执行文件一份承担三项工作：GUI 宿主、`dsh plugin` / `--profile` CLI，以及私有 Windows Job runner。带 `pkg` 的进程在普通 Windows spawn 时会再拉起同一可执行文件，并设置 `DSH_SUBPROCESS_RUNNER=windows`，目标 argv 放在私有 `--` 之后。插件市场的 `dshArgv()` 只把 `argv[1]` 匹配 `bin.js`、`bin.ts` 或 `dsh` 词干的情况当作本 CLI，否则走 PATH 上的 `dsh`。若子进程改去启动 GUI，会以 guest 占据单实例锁并以 0 退出，既不发 IPC，也不写 profile，于是父进程报 Job runner 干净失败，或安装成功但 `package.json` 未变。

## Decision

**SEA launcher 是 Job runner 的引导入口。** 当设置了 `DSH_SUBPROCESS_RUNNER` 时，`packaged-web-launcher.cjs` 跳过 `AllocConsole` 和 GUI，在 exe 旁解析 `@deepseek-ai/dsh-subprocess-local/runner`，改写 `process.argv` 使 `slice(2)` 从私有 `--` 开始，并调用 `runSelectedSubprocessRunner`。runner 导出或解析失败时以 127 退出，不回落到 GUI。

**GUI 启动在挂载 web profile 之前为插件市场改写 argv。** `withPackagedMarketCliArgv` 把 `argv[1]` 指到磁盘上的 `lib/bin.js`。市场随后用该 CLI 入口 spawn 本可执行文件，从而把 `DSH_HOME` 留在 `<exeDir>/.config` 并运行 `dsh plugin`，而不是第二份 GUI 实例或 PATH 上另一个 harness home。

CLI 头（`plugin`、`--profile`、help、version、config dump）仍从 extra argv 导入 `lib/bin.js`，不占用桌面锁。

## Alternatives considered

**把 runner.js 路径当作打包脚本参数，而不是环境变量选择器。** launcher 已经会导入第一个 extra `.js` 参数，但从 SEA 文件做动态 `import()` 时该模块不是 `import.meta.main`，runner 会加载却不运行。环境变量选择器是 `spawnRunnerInvocation` 在 `pkg` 下已经使用的契约。

**继续用 PATH 上的 `dsh` 作为市场安装通道。** 旁边的 `dsh.exe` 在它就是这份打包文件时可以工作。PATH 也会找到写入不同 home 的全局或 checkout `dsh`，或一个以 0 退出的 GUI guest。改写 argv 让进程内 spawn 在本可执行文件上点名 `lib/bin.js`。

**在打包 GUI 内关掉 Windows Job runner，改用回退 `spawnSubprocess`。** 这样可以避开缺失的引导，同时也会放弃桌面宿主每一条普通命令的 Job 收容。

## Consequences

打包 Job runner 子进程不再附着隐藏控制台，也不再走 GUI guest 路径。插件市场安装通过 `lib/bin.js` 作用于便携 `.config` profile。SEA 嵌入必须包含更新后的 launcher；仅更新磁盘上的 `lib/packaged-web-bin.js` 无法让旧 exe 跳过 `AllocConsole`。`apps/cli/tests/packaged-web-entry.spec.ts` 钉住 launcher 在 `attachHiddenConsole` 之前检查该环境变量，以及 GUI 对 `withPackagedMarketCliArgv` 的调用。
