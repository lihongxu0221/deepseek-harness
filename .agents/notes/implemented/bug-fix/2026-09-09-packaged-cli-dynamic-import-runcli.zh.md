# Agent Note: 打包插件安装必须在动态导入后调用 `runCli()`

Status: implemented

[English](2026-09-09-packaged-cli-dynamic-import-runcli.md) | 中文

## 问题

打包的 Windows Web exe 上，插件市场安装会报告成功（`exit=0`，stderr 为空），但 profile 的 `package.json` 没有变化。市场自己的校验于是判定安装通道根本没有运行。

GUI 进程会把 `argv[1]` 改写成磁盘上的 `lib/bin.js`，让插件市场的 `dshArgv()` 用这条路径 spawn 本可执行文件，而不是 PATH 上的 `dsh`。子进程的 SEA 仍以 `packaged-web-launcher.cjs` 为进程入口，再动态导入 `lib/bin.js`。`lib/bin.js` 只在 `if (import.meta.main)` 后面自执行。动态导入不会置位该标志，因此 `runCli()` 没有运行，进程无事可做，以 0 退出。

在实际打包 home 上测到：`dsh-agy-link` / `dsh-cost-meter` 的安装日志是 `exit=0 err=`，且没有 `desktop-host.log` 的 guest 行。这是空导入路径，而不是单实例 GUI 访客路径（访客总会写下 `role=guest`）。

## 决策

`apps/cli/src/packaged-web-entry.ts` 中的 `runImportedPackagedCli` 把 `process.argv` 改写成 `[execPath, lib/bin.js, ...cli]`，并**调用导出的 `runCli()`**。打包 Web 入口对 CLI 头使用该助手。SEA 启动器在导入的模块导出了 `runCli()` 时也会调用它，因此把 `lib/bin.js` 当成 worker 脚本 spawn 时仍会执行 CLI。

仍需要把 GUI 的 `argv[1]` 改写成 `lib/bin.js`，好让插件市场 spawn 本可执行文件。这并不够：导入方必须调用 `runCli()`。

## 考虑过的替代方案

**改写 argv 后仍依赖 `import.meta.main`。** SEA 启动器永远是进程入口。无论怎样改 argv，动态导入的 `lib/bin.js` 都不会成为 main 模块。

**再 spawn 一个 Node 把 `lib/bin.js` 当 main 跑。** 打包桌面把 Node 嵌在 GUI exe 里；PATH 上没有单独的 `node`。spawn 的还是这个 exe，它就是 Node。

**把空的 `runCli` 当成失败并以 1 退出。** 这能挡住假成功，但仍然不会装上插件。

**改插件市场，不再走 `dshArgv()`。** 市场是树外插件。当它重新调用本可执行文件时，让 `dsh plugin` 真正执行是打包宿主的责任。

## 后果

- 打包 GUI 里插件市场的 `dsh plugin --profile web add <pkg>` 会在 `.config/profiles/web` 里跑 pnpm，而不是以 0 退出且 profile 不变。
- 不导出 `runCli` 的 worker 脚本不变：启动器的额外调用对 `packaged-web-bin.js` 和原生辅助 worker 是空操作。
- 该调用的覆盖是 `runImportedPackagedCli` 单元测试，以及启动器与 `packaged-web-bin.ts` 含有该调用的源码断言。完整 SEA spawn 属于打包桌面重建，不属于本套件。

## 测试

`apps/cli/tests/packaged-web-entry.spec.ts` 断言 `runImportedPackagedCli` 会改写 argv 并调用 `runCli`，拒绝没有该导出的模块，且两个导入方源码都包含该调用。
