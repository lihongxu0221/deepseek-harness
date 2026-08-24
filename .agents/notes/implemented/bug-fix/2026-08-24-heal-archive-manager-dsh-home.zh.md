# Agent Note: 让随附的 archive-manager host 遵守 DSH_HOME

Status: implemented

[English](2026-08-24-heal-archive-manager-dsh-home.md) | 中文

## Problem

`@mlgbnb/dsh-archive-manager` 随附的 host `dshHome()` 返回 `join(homedir(), '.dsh')`，从不读 `$DSH_HOME`。打包桌面把会话和 `storages/workspace.json` 放在 `<product>/.config`。设置页因此对着 `~/.dsh` 列出空归档。导入后再改写导出无效：ESM 里模块内部的 `dshHome()` 调用仍是本地绑定。

## Decision

`healArchiveManagerHome` 在 Cordis 导入之前改写 profile `node_modules` 里的这份 host 文件。唯一改动是 `return process.env.DSH_HOME ?? join(homedir(), '.dsh')`。`prepareProfile` 每次启动都跑；`dsh plugin` 在安装成功后再跑一次，这样市场后装的包也会在下次启动前被修好。包不存在、host 已经提到 `process.env.DSH_HOME`，或写入失败时不做操作，启动仍继续。

这不取代 [`resolveDshHome`](../architecture/2026-07-24-single-harness-home-resolver.zh.md)。第三方文件不能导入 `@deepseek-ai/dsh-home-paths`；进程环境就是打包启动器已经设好的同一个 home。

## Alternatives considered

**只改 npm 包并等发版。** 否决为唯一修复：当前仍是 1.0.7，已解压的包会一直带着写死的 home，直到有人重装。

**导入后 monkey-patch 导出的 `dshHome`。** 否决：同一模块内的调用看不到被重新赋值的导出。

**把 `~/.dsh` 联接到 `<product>/.config`。** 否决：已经使用 `~/.dsh` 的 CLI 安装会和桌面 home 共享或冲突。

## Consequences

打包或搬家后的文件夹启动一次就能从 `$DSH_HOME` 列出归档，包括 zip 里仍是发布版 host 的情况。已经遵守 `$DSH_HOME` 的上游版本不会被改。`packages/boot/app-boot/tests/profile.spec.ts` 固定了改写、双引号形式、幂等和文件不存在时的空操作。
