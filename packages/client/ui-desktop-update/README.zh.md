---
description: "常规设置行：检查 GitHub 是否有更新的打包 Windows 桌面 zip，并驱动下载与退出替换。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-desktop-update

[English](README.md) | 中文

## 概述

本浏览器插件向常规设置贡献一行，与 Host [`dsh-host-desktop-update`](../../host/desktop-update/README.zh.md) 路由通信。它显示已安装的 `VERSION`，检查 GitHub，带进度下载更新的 `dsh-web-win-x64` zip，并提供「退出并更新」。在 Host 报告打包桌面（`mode` 不是 `unavailable`）之前该行不渲染，因此源码 `dsh web` 保持不变。

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

在 web 组合中与 Host 更新器一起挂载。该行占据 `settings.general.item`，id 为 `desktop-update`。文案位于 `settings.desktopUpdate` 语言命名空间。Host 拒绝非回环控制路由；403/404 视为 `unavailable`，该行保持隐藏。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

apply 世界的控制器对 `/api/desktop-update/*` 发起同源 Fetch，并通过 inject 的 `hooks` 隔间发布 snapshot store。下载期间每 500ms 轮询 `/progress`，直到 Host 离开 `downloading`。Apply 把中断的 Fetch 视为成功，因为 Host 在武装 helper 之后会退出。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Host 更新器](../../host/desktop-update/README.zh.md) — 检查、下载与应用。
- [常规设置](../ui-settings-general/README.zh.md) — 渲染该行的分区。

-----

<a id="model-experience"></a>
## 模型体验

无，因为设置行只与 Host 更新器 HTTP 路由通信。

#### KV 缓存影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义当前设置行。它们是当前包约束，不是任务积压。

- **仅 Web 打包桌面** — 非 Web 客户端与源码 `dsh web` 看不到该行。
- **无侧栏徽标** — remote-web-ui 上的 npm 全家桶下载控件是另一套更新器，不会复用。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>

**运行时不变量：** 不发布伴随包。命令与 slot 贡献生命周期由 HMR 安全规格证明，浏览器控制器不拥有 Host 事件。
