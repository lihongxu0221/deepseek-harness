# Agent Note: 受信任 LAN 源持久化配置面

Status: implemented

[English](2026-08-20-trusted-lan-configuration-plane.md) | 中文

## Problem

同源页面在派生的 LAN IP 上（桌面 `0.0.0.0`，或任何 `trustedHosts` 权威）已经能到达 `session.prompt`。配置面不行：浏览器设置镜像在 `isLoopback` 为 false 时选择 `memory`。打开 `http://<lan-ip>` 时，模型页显示「settings are unavailable in this browser」，通用设置写入也到不了 Host。

这层额外钉死是开着大门旁边的篱笆：Connection 已经用同一浏览器会话认证完整 Host API。原生桌面操作是另一类事——对话框或打开器出现在宿主机器上，而不是 LAN 浏览器上。

## Decision

浏览器设置镜像和每一个绑定的 scope 都使用 `host` 持久化。因此配置读写在受信任 LAN 源上与回环一样持久化到 Host。

原生桌面操作在 Client 上仍限回环：`ui-settings-general` 在非回环页面上仍不挂载设置文件操作。Connection 对生成的 Remote 方法统一鉴权；Host/Origin 失败仍在核对身份之前返回 403。

这修正了[配置面边界](2026-07-30-config-plane-boundaries.zh.md)中「配置面仅限回环」的规则，以及[Web 配置面](2026-07-30-web-config-plane.zh.md)中的 Client 持久化规则。`llm.discoverModels` 不再仅限回环；[草稿提供方探询](2026-08-04-draft-provider-endpoint-interrogation.zh.md)中的 SSRF 顾虑，对已经能 `session.prompt` 的调用方被接受。

## Alternatives considered

**保留空信任钉死，并让用户改开 localhost。** 拒绝，因为桌面监听对话框把 `0.0.0.0` 作为 LAN 访问提供，而模型页没有 `settings.describe` 就无法使用。

**在浏览器里把任意 IPv4 字面量当成 loopback。** 拒绝，因为 loopback 判定是 hostname 事实，服务器已经通过 `trustedHosts` 点名 LAN IP。客户端持久化跟随线路，而不是第二套 IP 启发式。

**连原生打开器一并解钉。** 拒绝，因为 LAN 上的点击会在宿主桌面弹出对话框。

## Consequences

受信任 LAN 源可以加载提供方目录、编辑通用设置，并把凭据存到 Host。能打开该源的人也能改配置；他们本来就能驱动 agent。原生打开文件与选择目录仍限回环。preset 组装文本仍仅限回环。

## Testing

`packages/client/ui-settings/tests/settings-scope.client.spec.ts` 在非回环连接上以 host 模式绑定并读取。`packages/client/ui-settings-general/tests/apply.client.spec.ts` 在非回环上仍不挂载文档操作，但允许 describe 读取。
