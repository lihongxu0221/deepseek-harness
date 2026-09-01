# Agent Note: 非安全 HTTP 源上的客户端 rpcId 签发

Status: implemented

[English](2026-08-20-insecure-origin-rpcid-minting.md) | 中文

## Problem

浏览器在非安全上下文中不提供 `crypto.randomUUID`。对 LAN IP 字面量使用 HTTP 不是安全上下文，而 `localhost` 是。Web GUI 把 LAN IP URL 当作受支持的访问路径（[API 浏览器信任边界](../architecture/2026-07-28-api-browser-trust-boundary.zh.md)）：权威栅栏接纳这些字面量，且 `agentPreset.list`、`llm.providers` 等配置读取并不限制在环回地址。

客户端 RPC 签发对每一次一元调用都使用 `crypto.randomUUID`。因此在 `http://<lan-ip>` 打开设置会在 fetch 之前抛出 `crypto.randomUUID is not a function`，Agent 预设名单和提供方目录都加载失败。浏览器在非安全源上仍暴露 `crypto.getRandomValues`；`crypto.randomUUID` 则没有。

## Decision

Connection 通过 `packages/client/connection/src/client/random-uuid.ts` 签发 rpcId：用 `crypto.getRandomValues` 生成 RFC 4122 UUID v4，并在进程内写入版本与变体位。每一次 Connection 一元调用——包括 `agentPreset.list` 与 `llm.providers`——都经过该辅助函数。

## Alternatives considered

**只在 `WebApiClient` 上覆盖 `mintRpcId`。** 浏览器侧 diff 更小，但 `FixtureApiClient` 以及之后的子类在同一非安全源上仍会调用 `crypto.randomUUID`。

**存在 `crypto.randomUUID` 时优先调用，否则回退。** 同一 id 格式出现两条签发路径。`getRandomValues` 在本载体运行的环境中都可用（浏览器非安全源与 Node ≥19），回退分支并不会成为 Node 独有路径。

**要求 HTTPS 或 localhost。** 这会拒绝信任栅栏已经接纳的 LAN IP 服务路径。

## Consequences

浏览器在 `http://<lan-ip>` 上可以加载 Agent 预设名单和提供方目录。rpcId 仍是 UUID v4；改变的只是 Web Crypto 入口。Composer 草稿附件 id 仍调用 `crypto.randomUUID`，不属于此次签发。

## Testing

`packages/client/connection/tests/client-apply.client.spec.ts` 把 `crypto` 桩成仅有 `getRandomValues`，并断言 Connection RPC 在非安全 LAN 源上仍签发 version-4 id。
