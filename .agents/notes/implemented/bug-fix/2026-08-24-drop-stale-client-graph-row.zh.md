# Agent Note: Drop a client graph row when a live package loses dsh.client

Status: implemented

[English](2026-08-24-drop-stale-client-graph-row.md) | 中文

## Problem

Web 启动图是 `window.__DSH_BOOT__`。每一行都是当前声明了 `dsh.client.platform: "web"` 并且提供 `exports["./client"]` 的包。浏览器随后拉取 `/plugins/<id>/client.js?rev=…`。

社区插件可以不再当客户端包，同时仍留在 loader 树里。暴露这个问题的是 `@linxin666/dsh-client-ui-community-plugins@0.3.2`：它还是发布 `community.json` 的惰性 host 行，但不再附带 `lib/client.js` 或 `dsh.client` 声明。升级之后，长驻桌面进程仍在广告旧的 `/plugins/@linxin666/dsh-client-ui-community-plugins/client.js?rev=…`。脚本 404，启动页报 “Failed to load plugins”。

两处缓存让过期行在插件更新后的 fiber 事件里活下来：

- 名字已在表里时 `processOne` 直接返回，因此仍挂着的 host 条目不会丢掉客户端行。
- `pkgMeta` 把上一次 `dsh.client` 判定缓存到进程结束，即使再扫一次也会沿用旧声明。

新进程重新组成的图已经不会收录这个包。打包 Chromium 窗口仍可能启动上一份 index，其注入的图还点名已删除的 `client.js`。

## Decision

`ClientModuleRegistry.processOne` 在每次 dirty flush 时删除该名字的 `pkgMeta` 并重读 `package.json`。若这个包不再是 web 客户端行，表就删掉该名字。未变化的客户端行仍保留 revision；重新哈希包字节的路径仍然只有 `rebuilt()`。

激活扫描走同一函数，因此对着这个纯 host 包启动的进程不会广告客户端 URL。

对打包桌面这还不够。index HTML 里嵌着 `window.__DSH_BOOT__`，以前只带 `Content-Type`，所以 `dsh-web.exe` 重启后 Chromium 仍会用升级前的图。`frontend-static` 现在对每个 index 响应发送 `Cache-Control: no-store`，桌面窗口 URL 带上 `?boot=<graph.rev>`，即使磁盘缓存早于这个头，插件集合变化也是一次新导航。

## Alternatives considered

**要求重启进程。** 这是原先写在 `pkgMeta` 上的注释。打包桌面是长驻 owner 进程；插件管理器就地更新包装并重启 fiber。每次降级成 host-only 都让用户退出再开，启动页会一直坏到他们这么做。

**保留旧行、让旧 URL 404。** 客户端 loader 仍会 import 图里的每个 id。404 还是同一张 “Failed to load plugins” 页。

**每次 fiber 事件都重新哈希。** 对仍是客户端插件的包没有必要；内容变化已由 HMR 经 `rebuilt()` 负责。

## Consequences

一次去掉 `dsh.client` 的在线升级会在下一次 `internal/plugin` flush 丢掉该行。下一次 index 请求给出的图不再含那个 URL，且不得从缓存回答。升级之后打开的桌面窗口落在 `?boot=<new rev>`。

一次给原先纯 host 包 *加上* `dsh.client` 的在线升级同样生效，因为否定的 `pkgMeta` 判定不再是永久的。

## Testing

`packages/client/modules/tests/node-half.client.spec.ts` 先搭一个客户端夹具并构造 registry，再把包改成去掉 `dsh.client`，发出 `internal/plugin`，并在 microtask flush 之后期望图为空。`packages/host/frontend-static/tests/frontend-static.spec.ts` 断言 index 的 `Cache-Control: no-store`，以及普通资源不加该头。`apps/cli/tests/packaged-web-desktop.spec.ts` 断言窗口 URL 带 `?boot=<rev>`。
