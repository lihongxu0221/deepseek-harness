# Agent Note: 种进打包 web profile 的社区插件必须仍能启动

Status: implemented

[English](2026-08-31-packaged-web-seeded-plugin-boot.md) | 中文

## Problem

`build-web-exe` 会把 `dshmarket` 和 `@linxin666/dsh-web-ui-all` 种进 `.config/profiles/web`。这些包从 `@deepseek-ai/dsh-settings` 导入 `settingsNamespace` 和 `installSettingsSection`，`@linxin666/dsh-remote-web-ui` 还从 `@deepseek-ai/dsh-host-apiproxy/api/rpc` 导入 `RpcId`。master 已把 settings 助手收进 `SettingsProvider` 方法，并删除了 API Proxy。缺一个导出或模块说明符就会让整个 web profile fail-loud，打包桌面托盘还在、监听端口没有。`desktop-host.log` 只记到单实例锁。这些名字能解析之后，`@linxin666/dsh-remote-web-ui` 和 `@linxin666/dsh-client-ui-task-board` 仍会 inject `apiProxy`，Loader 会让整棵树停在 pending。

## Decision

从 `@deepseek-ai/dsh-settings` 再导出 `settingsNamespace` 和 `installSettingsSection`。它们给命名空间打品牌并调用 `SettingsProvider.installSection`，不是第二套 settings 缝。`healHostApiproxyRpcStub` 在 `$DSH_HOME/profiles/node_modules/@deepseek-ai/dsh-host-apiproxy/api/rpc.js` 写入私有的 `RpcId` 恒等助手。这个桩不是 API Proxy。`prepareProfile` 和 `dsh plugin` 会跑这次 heal；已有包不动。打包桌面的启动失败也会追加到 `desktop-host.log`。`resolveApiproxyDependentDisablePatches` 随后在用户层和 `--patch` 层之后禁用种子里的 `web-ui-task-board` / `web-ui-remote-web-ui` 行（以及独立安装的 `ui-task-board` / `remote-web-ui` id）。其余种子 UI 插件仍会挂载。

## Alternatives considered

**丢掉种子插件，直到它们对准当前导出。** 否决：打包默认就该带着这些钉扎插件启动。只禁用两个 inject `apiProxy` 的条目，就能保住其余钉扎。

**恢复 API Proxy 包。** 否决：桩能满足的现场导入只有 `RpcId`，这个包是有意删的。兼容用的 `ctx.apiProxy` 等于把已删服务再请回来。

**缺社区插件时 fail-soft，而不是 fail-loud。** 否决：Loader fail-loud 是 profile 约定；缺的名字是我们这边要保住的。

## Consequences

仍种这些钉扎插件的打包文件夹可以组合 web profile。远程控制和任务板的 Host 插件会保持未挂载，直到它们不再 inject `apiProxy`。以后不再导入旧名字的社区插件不受影响。Host 组合之后，这些钉扎仍会 `require` 已删除的 Runtime 说明符；[client-store 别名](2026-08-31-packaged-web-client-runtime-alias.zh.md) 回答这次模块表 miss。`packages/settings/settings/tests/settings.spec.ts` 固定了再导出。`packages/boot/app-boot/tests/profile.spec.ts` 固定了桩写入和“已有包不动”规则。`apps/cli/tests/telemetry-switch.spec.ts` 固定了禁用 overlay。
