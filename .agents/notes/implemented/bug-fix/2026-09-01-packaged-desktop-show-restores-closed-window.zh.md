# Agent Note: Tray Show restores a closed Chromium app window

Status: implemented

[English](2026-09-01-packaged-desktop-show-restores-closed-window.md) | 中文

## Problem

关闭打包的 `--app` 窗口后，Edge 或 Chrome 常常仍在 `$DSH_HOME/desktop-chromium` 下运行。托盘「显示主界面」把仍被跟踪的进程当成可见窗口，只发送 `focus`。托盘要求该 pid 上有可见 HWND，否则什么也不做。左键和**显示主界面**失效。**系统设置**总会杀掉被跟踪进程并打开 `#settings`，所以只有这一项能唤回界面。

## Decision

托盘的 `focus` 处理会前置 pid 匹配、或标题为 `DeepSeek Harness`、或以 ` — DeepSeek Harness` 结尾的可见窗口。找不到则发出 `window-missing`。Node 仅在该回复紧跟一次「对已跟踪窗口请求前置」的显示主界面时，才重新打开回环 URL，这样刚 spawn 后发送的 `focus` 不会循环。系统设置仍总是带 `#settings` 重开。单实例管道仍只接受 `show`。协议归属仍在 [Windows 闪窗与托盘](../feature/2026-08-19-windows-packaged-desktop-tray.zh.md) 记录。

## Alternatives considered

**让显示主界面像系统设置一样总是关掉再开。** 否决：窗口仍可见时点显示主界面会杀掉 Chromium 进程，丢掉页内草稿。

**去掉 `DESKTOP_WINDOW_HANDOFF_MS`，每次显示主界面都 spawn。** 否决：启动器在 2 秒内退出时，第一扇窗口还在屏幕上就会再开一扇 `--app` 窗口。

## Consequences

托盘显示主界面会把已有产品窗口前置；用户关掉窗口后，即使 Chromium 留下后台进程，也会再开一扇。`apps/cli/tests/windows-desktop-shell.spec.ts` 固定 `window-missing` 和标题匹配。`apps/cli/tests/packaged-web-desktop.spec.ts` 固定显示主界面后的 missing 会重开、其它 missing 忽略，以及启动器立即交接时在 missing 之前仍不 spawn。
