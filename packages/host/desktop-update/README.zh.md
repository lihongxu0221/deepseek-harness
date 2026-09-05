---
description: "打包 Windows 桌面更新器：检查 GitHub Releases 是否有更新的 dsh-web-win-x64 zip，下载后替换程序文件并保留 .config。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-desktop-update

[English](README.md) | 中文

## 概述

本 Host 插件用于更新已打包的 Windows 桌面目录。它读取 `dsh-web.exe` 旁的 `VERSION` 戳，列出配置仓库的 GitHub Releases，并把更新的 `dsh-web-win-x64-*.zip` 附件视为一次更新。仅限回环的 `/api/desktop-update` 路由族供设置行检查、带进度下载，并在本进程退出后武装 helper，把解压树拷进产品目录。拷贝从不包含 `.config`，因此会话、凭据与 profile 插件留在本机。源码 `dsh --profile web` 的 Node 旁没有 `VERSION`，插件报告 `unavailable`，不暴露下载或替换。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 web 组合中于 `connection` 之后挂载。浏览器设置行是 [`dsh-client-ui-desktop-update`](../../client/ui-desktop-update/README.zh.md)。配置字段：

- `repository`（`owner/name`，默认 `lihongxu0221/deepseek-harness`）— 发布 winexe zip 的 GitHub 仓库。
- `assetPrefix`（默认 `dsh-web-win-x64-`）— 必需的 zip 文件名前缀。
- `checkOnBoot`（默认 `true`）— 当本进程是打包桌面时，加载后列出 Releases。
- `cacheTtlMs`（默认 `600000`）— 成功列表在此毫秒内复用，除非用户点击检查。

全部控制路由拒绝非回环主机名，包括 Connection 已为普通 `/api` 授权的局域网绑定。`/api/update` 属于另一个插件（npm 全家桶自更新），此处不用。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

VERSION 戳是 `{semver}` 或 `{semver}.winexe.{n}`。比较先对 base 使用 semver 优先级，仅在 base 相同时比较 winexe 迭代。GitHub `/releases/latest` 会跳过预发布，因此插件列出 `/releases`。草稿以及不符合配置 zip 前缀的附件被忽略；从不下载源码 zipball。缺少 GitHub `digest` 会使下载失败：helper 绝不拷贝未校验的 zip。解压后剥掉单层包裹目录，树中必须有 `VERSION` 和 `dsh-web.exe`（或 `dsh-web`）。Apply 在 `$DSH_HOME/desktop-update` 写入 PowerShell 5.1 helper，脱离启动后退出，托盘宿主随 Node stdin 关闭。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [客户端行](../../client/ui-desktop-update/README.zh.md) — 设置呈现。
- [打包 Web 桌面](../../../.agents/notes/implemented/feature/2026-08-18-packaged-web-desktop-exe.zh.md) — 产品目录与 VERSION 戳。
- [CLI 打包桌面](../../../apps/cli/README.zh.md) — zip 如何构建与发布。

-----

<a id="model-experience"></a>
## 模型体验

无，因为打包桌面更新器不注册任何面向模型的内容。

#### KV 缓存影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义当前更新器。它们是当前包约束，不是任务积压。

- **仅 Windows zip** — apply 只在 `win32` 上运行，且只针对配置的 `dsh-web-win-x64-` 附件前缀。
- **只读 Releases 第一页** — 检查读取 `per_page=30`，不跟随分页。
- **匿名 GitHub API** — 限额表现为 `mode: error`；此版本没有 token Config。
- **必须退出** — 从不原地覆盖正在运行的启动器。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>

**运行时不变量：** 不发布伴随包。更新器是 Host HTTP 控制面，其观察（VERSION 文件、GitHub JSON、解压树）无法与独立的进程内探测分叉。
