# Agent Note: Packaged desktop GitHub zip update

Status: implemented

[English](2026-09-05-packaged-desktop-github-update.md) | 中文

## Problem

winexe 桌面是约 270MB 的文件夹，以 GitHub 预发布 zip 发布。已经在运行 `dsh-web.exe` 的用户无法在产品内得知是否有更新的 `dsh-web-win-x64-*.zip`，也无法在不手动下载 Release 的情况下替换程序文件。已种子的 `@linxin666/dsh-remote-web-ui`「检查更新」走 `/api/update`，对 npm 插件全家桶执行 `pnpm update`；它不读取 [lihongxu0221/deepseek-harness/releases](https://github.com/lihongxu0221/deepseek-harness/releases)，也不得被重载成产品 zip 更新。

## Decision

把更新器做成两个 Cordis 插件，而不是启动器逻辑：

- [`dsh-host-desktop-update`](../../../../packages/host/desktop-update/README.zh.md) 读取 exe 旁的 `VERSION`，列出 GitHub Releases（包含预发布；`/releases/latest` 会跳过它们），下载配置的 `dsh-web-win-x64-` zip，校验 GitHub `sha256` digest，解压，并武装脱离的 PowerShell helper。
- [`dsh-client-ui-desktop-update`](../../../../packages/client/ui-desktop-update/README.zh.md) 增加一行通用设置。源码 `dsh web` 仍会加载 Host 插件并返回 `mode: unavailable`，该行显示「当前不是打包桌面」。缺失路由的 HTTP 403/404 显示为错误，而不再把整行藏掉。

控制路由位于 Connection 已鉴权 Fetch 通道上的 `/api/desktop-update/*`，并额外拒绝非回环主机名，因此局域网/手机会话不能发起 270MB 下载或替换产品目录。Apply 从不拷贝 `.config`。helper 等待本 PID 退出，用 `/XD .config` robocopy 解压树，再拉起 `dsh-web.exe`。随后 Node `process.exit(0)`；Windows 托盘宿主在 stdin 关闭时已经会退出。

版本戳是 `{semver}` 或 `{semver}.winexe.{n}`。比较对 base 使用 semver 优先级；winexe 迭代只作平局 tiebreaker。GitHub 仓库与附件前缀是 Config（默认 `lihongxu0221/deepseek-harness` 与 `dsh-web-win-x64-`）。只有用户点击才下载；启动至多列出 Releases。

两个插件插入 web-app 组合包，打包 zip 自带它们，不必再发 npm。

## Alternatives considered

**写进 `packaged-web-bin` / 薄 pkg 启动器。** 否决，因为检查针对本 fork 的 winexe zip，且用户要求插件模式。缺少 `VERSION` 时插件在源码 `dsh web` 上已经是空操作。

**复用 `/api/update` 与 remote-web-ui 下载按钮。** 否决，因为那条链路用 pnpm 更新 `@linxin666/dsh-web-all`。把 270MB 产品 zip 塞进同一按钮会替换错误的树。

**electron-updater / Squirrel / 原地覆盖正在运行的 exe。** 否决：发布产物是文件夹 zip，Windows 会锁住 `dsh-web.exe`，现有托盘已把 Node 退出视为退出。

**用 Typert Remote 做 status/download。** v1 否决：大 zip 的下载进度适合 Connection Fetch 加轮询；unary Remote 仍需要第二条进度通道。

## Consequences

打包桌面用户在 exe 旁有 `VERSION` 时，可在设置 → 通用设置看到「桌面更新」。检查 GitHub 不会下载 zip。Apply 保留 `.config`（会话、凭据、种子与用户安装的插件）。测试钉住版本比较、zip 选择（跳过草稿与不匹配附件）、回环 403、digest 失败、helper 脚本排除 `.config`，以及 Host 不是打包桌面时的 unavailable 文案。没有成功 Apply 的组装应用 snapshot。交叉链接：[打包 Web 桌面](2026-08-18-packaged-web-desktop-exe.zh.md)，[Windows 闪窗与托盘](2026-08-19-windows-packaged-desktop-tray.zh.md)。
