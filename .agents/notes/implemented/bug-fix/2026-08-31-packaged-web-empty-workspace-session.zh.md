# Agent Note: 打包 web 从空工作区开会话，并对未知的已存默认 preset 回退

Status: implemented

[English](2026-08-31-packaged-web-empty-workspace-session.md) | 中文

## Problem

去掉社区插件后，打包桌面可以添加工作区（`workspace.json` 记下路径），但从不写入 `$DSH_HOME/sessions`，也打不开空白会话。两个独立失败叠成这个空状态。

侧栏工作区行只切换展开。空分组没有可点的会话行，因此点击刚添加的工作区没有效果。新建会话是加号控件，且仅在悬停时出现。

`settings.yaml` 仍存储 `agent-presets.default: code`。该 id 不在随附名单里（`standard`、`minimal`、`ptc`、`cordis`）。创建会话会无 id 调用 `agentPresets.resolve()`，未知的已存默认值以 `agent-preset/not-found` fail-loud。`startSession` 只把这次失败 `console.warn` 掉。

## Decision

点击空的真实工作区行会在该工作区开会话（与加号同一条路径）并展开分组。已有会话的分组仍只做展开/折叠。

隐式 `resolve()` 在已存用户默认值不在名单中、且组装 `default` 存在时，使用组装 `default`。`defaultId` 仍报告已存用户值，好让选择器能显示它。显式给出未知 id 仍会失败。

## Alternatives considered

**改写打包 home 里的 `settings.yaml`。** 否决：已存名字以后可能重新有效；改写每个 home 是迁移，不是名单解析规则。

**把 `defaultId` 本身改成组装默认值。** 否决：选择器和设置文档会藏起用户仍持有的已存值。

**行点击继续只展开。** 否决：空工作区就没有可选择的会话；仅悬停出现的加号容易漏掉。

## Consequences

添加工作区后点击空行会打开空白会话。仍存储 `code` 的 home 会按 `standard` 建会话，直到用户选一个现存 preset。显式 `resolve('code')` 仍失败。`packages/preset/agent-presets/tests/settings.spec.ts` 与 `packages/client/ui-workspace/tests/workspace-browser.client.spec.tsx` 钉住这两条路径。
