# Agent Note: 把内置社区插件种进打包 web profile

Status: implemented

[English](2026-08-23-packaged-builtin-profile-plugins.md) | 中文

## Problem

打包桌面文件夹不带 `.config`。首次启动因此只跑 `base + web-app` 组合。插件市场和其他社区 UI 插件要等有人在市场里安装才会出现，于是双击产品缺了 winexe 构建本应带上的插件。

## Decision

`scripts/build-builtin-profile-plugins.ts` 在 staging 部署之后种 `.config/profiles/web`。钉扎版本写在 `scripts/builtin-profile-plugins.json`，只接受精确 semver。缺失的 bundle 条目追加到末尾；已有但不同的依赖规格仍归用户，除非 `--refresh`。已经满足的 profile 是空操作，跳过 pnpm。`allowBuilds` 追加到 profile 的 `pnpm-workspace.yaml`，这样钉扎插件需要的原生安装脚本（node-pty、ssh2、cloudflared、cpu-features）不会被拦住。`initProfile` 之后 seeder 会重读 manifest，合并时保留骨架的 `name` 和 `private`。已有产品文件夹里被保留的 `.config` 仍然压过新的 seed。

## Alternatives considered

**把插件装进产品 `node_modules`，而不是 profile。** 否决：树外插件属于 profile 自己的 `node_modules`，也就是 `dsh plugin --profile web add` 写入的位置。

**每次重建都重新钉扎。** 否决：那会在每次 `build-web-exe` 覆盖用户选的版本。只追加外加可选 `--refresh` 才能让重建保持加法。

**首次启动留空，再文档化一次市场安装。** 否决：还要再装一步的双击产品不是打包默认。

## Consequences

新打出来的文件夹启动时，钉扎插件已经可解析。winexe zip 只拷这份种好的 `profiles/web`，其余 `.config` 不进包，这样发布文件夹不会带上构建机的会话或凭据。`scripts/build-builtin-profile-plugins.spec.ts` 固定了合并、首次 seed 的身份字段、allowBuilds 追加、dry-run 和空操作。打包桌面 README 记录了这次 seed。
