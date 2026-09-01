# Agent Note: 打包 web 把已删除的 Runtime 说明符播到 client-store 上

Status: implemented

[English](2026-08-31-packaged-web-client-runtime-alias.md) | 中文

## Problem

种子里的 `@linxin666/dsh-web-ui-all@0.2.9` 客户端插件仍会 `require("@deepseek-ai/dsh-client-runtime/client")`。Runtime 拆成 `dsh-client-store` 和功能包时这个包已删除。模块表没有这个 seed 词，也没有图行，因此在 Host Connection 已经认证之后，物化 `@linxin666/dsh-client-ui-web-ui-settings` 会以 `missed the module table` fail-loud。这些钉扎从 Runtime 调用的导出只有 `createSnapshotStore` 和 `defineStore`，它们现在在 `@deepseek-ai/dsh-client-store` 上。

## Decision

`getStaticModules()` 把 `@deepseek-ai/dsh-client-runtime` 和 `@deepseek-ai/dsh-client-runtime/client` 别名到已有的 `dsh-client-store` seed。seed 匹配是精确的，因此包名和 `/client` 子路径都要有。这些键不进入 `PLATFORM_MODULES`：第一方 bundle 不得把已删除的说明符当基座。

## Alternatives considered

**禁用仍 require Runtime 的每一行种子。** 否决：那会丢掉只需要 store 助手的设置、宠物、doctor 等钉扎。Host 侧 inject `apiProxy` 的条目仍单独禁用。

**恢复 Runtime 包。** 否决：这个包是有意删的；现场调用是 store 助手。

**把该说明符加进 `PLATFORM_MODULES`。** 否决：那会让第一方 tsdown 把已删除的名字当成隐式 external。

## Consequences

打包桌面可以物化仍 require 旧说明符的其余种子 UI 插件。以后若再导入其他已删 Runtime 导出，仍会 miss the table。`packages/client/web/tests/seed.client.spec.ts` 固定了别名落到 `createSnapshotStore` 和 `defineStore`。
