# Agent Note: 打包桌面必须打开带进程 token 的 Web URL

Status: implemented

[English](2026-08-31-packaged-web-desktop-auth-url.md) | 中文

## Problem

`dsh web` 会打印并打开 `connection.authenticatedUrl`。打包 Windows 桌面打开的是 `http://127.0.0.1:<port>`（托盘的“打开 URL”项也用同一 origin）。Host Connection 于是对窗口和浏览器的每次请求都回答 `401`，正文是 `dsh web authentication required; reopen the URL printed by dsh web.`

## Decision

`runPackagedWebDesktop` 用 loopback 上的 `ctx.connection.authenticatedUrl` 构造窗口 URL，再追加 `boot` 和 `#settings`。托盘的 `listen` 消息可以带上同一条 URL；PowerShell 宿主在启动默认浏览器时优先用它，而不是自己拼 `http://host:port`。托盘菜单文案会去掉 query 和 fragment，进程 token 不会出现在菜单里。停止服务时省略 `url`，托盘不会留下过期 token。

## Alternatives considered

**桌面继续打开干净 origin。** 否决：Connection 第一次 GET 需要进程 token。

**不经查询 token 直接发 cookie。** 否决：那会绕过 Host Connection 的登录交换。

## Consequences

打包窗口和托盘的“打开 URL”动作给出的登录 URL，与 `dsh web` 打印的相同。托盘文案只显示 origin。`apps/cli/tests/packaged-web-desktop.spec.ts` 固定了启动、显示、设置和 boot-rev URL 上的 token。`apps/cli/tests/windows-desktop-shell.spec.ts` 固定了托盘覆盖字段、`DisplayListenUrl`，以及 `Start-Process` 使用 `ListenUrl`。
