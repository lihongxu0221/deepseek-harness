# Agent Note: Workspace extra folders

Status: implemented

[English](2026-08-19-workspace-extra-folders.md) | 中文

## Problem

一个 Workspace 原先只对应一个规范目录。用户如果把相关仓库并排放在一起，要么注册多个 Workspace，要么把沙箱放宽到 `danger-full-access`，才能让一次会话写到 cwd 之外。多个注册会拆散会话列表；完全放开沙箱则会丢掉 workspace-write 边界。

## Decision

Workspace 保留主路径 `path`（新建会话的 cwd）以及额外的 `folders` 列表。每个规范目录最多属于一个 Workspace，作为主路径或额外文件夹。`Workspace.addFolder`／`removeFolder` 以及 `workspace.addFolder`／`workspace.removeFolder` RPC 修改该列表。移除主路径会以 `workspace-folder-primary` 失败；占用已被其他 Workspace 拥有的路径会以 `workspace-folder-conflict` 失败。在 `folders` 字段出现之前写入的记录解析为空的额外列表。

会话归属会把 header cwd 对照主路径或任一额外文件夹。从 Workspace 新建的会话仍以主路径为 cwd。`workspace-write` 策略解析会读取已挂载的 workspace 注册表，并把 `SandboxExecutionPolicy.extraRoots` 设为其余每一个已拥有目录，因此 cwd 落在额外文件夹上的会话仍可写主路径。`writableRoots`、Seatbelt、Landlock、bwrap 以及 Windows ACL 常驻授权都消费该列表；之后的 `addFolder` 会在下一次 confine 时拿到 ACE。

侧边栏 Workspace 行菜单提供 **添加文件夹…**（与添加 Workspace 共用同一目录流 slot）和 **移除文件夹**（只列出额外文件夹）。悬停卡片列出该 Workspace 拥有的全部目录。

## Alternatives considered

**继续用多个 Workspace 注册，每个只含一个文件夹。** 已经上线，但会拆散会话列表，也不会扩大当前会话的可写根。

**把额外根写进 Session header。** header 不可变，之后再加文件夹到不了已有会话。活的 Workspace 文件夹会在下一次策略解析时生效。

**提升领域版本并拒绝旧记录。** 额外文件夹在解析时默认，现有用户注册表可以继续加载。提升版本会丢掉所有已存储的 Workspace。

## Consequences

多文件夹 Workspace 中的 workspace-write 会话可以修改每一个已拥有目录，而不必切换沙箱模式。新建会话仍从主目录开始；额外文件夹是附加根，不是替代主目录。同一路径不能同时属于两个 Workspace，因此把另一个 Workspace 的主路径加进来是冲突，而不是合并。

## Testing

`packages/workspace/workspace/tests/workspace.spec.ts` 覆盖添加／移除、按额外 cwd 归属，以及冲突／主路径错误。`packages/host/apiproxy/tests/api-proxy-workspace.spec.ts` 与 `rpc-schemas.spec.ts` 覆盖 RPC 和传输默认值。`packages/sandbox/sandbox/tests/roots.spec.ts`、`sandbox-policy/tests/policy.spec.ts` 与 `sandbox-local/tests/local.spec.ts`、`acl-grants.spec.ts` 覆盖额外可写根、额外文件夹会话 cwd、Windows ACL 即时授权，以及模型可见的策略语句。`packages/client/ui-workspace/tests/rows.client.spec.tsx` 覆盖行菜单。
