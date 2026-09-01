# Agent Note: 让 profile 的 storeDir 对齐当前 pnpm store

Status: implemented

[English](2026-08-23-profile-storedir-current-pnpm-store.md) | 中文

## 问题

pnpm 拒绝向 `.modules.yaml` 缺少 `storeDir`、或该路径与即将使用的 store 不一致的 `node_modules` 安装（`ERR_PNPM_UNEXPECTED_STORE`）。判断条件是 `if (!modules.storeDir || path.relative(...) !== '')`。可移植布局 heal 删掉 `storeDir` 之后，随包发出的 web profile 因此无法跑 `dsh plugin update`，因为记录下来的 store 变成了 `undefined`。把 `virtualStoreDir: node_modules/.pnpm` 写进 `.modules.yaml` 是第二次不匹配：pnpm 会把该字段拼到 `node_modules` 上，于是读到 `node_modules/node_modules/.pnpm` 并抛出 `ERR_PNPM_UNEXPECTED_VIRTUAL_STORE`。

## 决策

`healProfileVirtualStoreDir` 不删除 `storeDir`。`dsh plugin` 在 profile 目录里探测 `pnpm store path`，并把该路径传给 heal，让它在转发的 `pnpm` 命令之前写进去。启动仍然只改写可移植的 `virtualStoreDir`。该 yaml 字段会拼到 `node_modules` 上，所以 heal 写入 `.pnpm`，而不是 npmrc 里的 `node_modules/.pnpm`。Heal 同时解析 JSON 和 YAML，因为 pnpm 在一次成功安装后会写成 YAML。

这是[打包内置 profile 插件](../feature/2026-08-23-packaged-builtin-profile-plugins.zh.md)里可移植布局工作的 store 一侧。

## 备选方案

**在 `.npmrc` 里钉死 profile 本地的 `store-dir`。** 否决：这会分叉用户的 store，而且仍需要只有正在运行的 pnpm 才知道的版本后缀（`v10`/`v11`）。

**继续删掉 `storeDir`，让用户自己跑 `pnpm install`。** 否决：那是报错文案里的恢复提示，不是产品路径；插件市场更新会继续失败。

**每次 store 不匹配就删除 `node_modules` 再重装。** 否决：打包 profile 已经有一份 hoist 树；更新时整树清掉又慢，安装中途失败还会丢掉用户已装的插件。

## 后果

搬家或随包发出的文件夹可以在本机当前 store 上更新插件。启动不会拉起 pnpm。不经 `dsh plugin`、直接在 profile 里跑 `pnpm add` 时，仍可能看到打包机留下的陈旧 `storeDir`，直到下一次 `dsh plugin` heal。
