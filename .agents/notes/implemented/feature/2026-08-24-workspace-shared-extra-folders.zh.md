# Agent Note：Workspace 共享额外文件夹

Status: implemented

[English](2026-08-24-workspace-shared-extra-folders.md) | 中文

## Problem

[Workspace extra folders](2026-08-19-workspace-extra-folders.zh.md) 让一个 Workspace 可以持有多个目录，但一个规范目录仍最多属于一个 Workspace。把已被其他 Workspace 当作额外文件夹的目录再加进来会以 `workspace-folder-conflict` 失败。用同一目录创建 Workspace 会返回既有归属方且 `created: false`，因此 GUI 无法把它注册为新的主目录。额外文件夹也不会出现在 `read-only` 或 `danger-full-access` 的 `sandbox:policy` 句子里，这些模式下的会话看不到它们。

## Decision

注册表内只有主目录唯一。一个额外文件夹可以属于多个 Workspace，也可以同时是另一个 Workspace 的主目录。`addFolder` 不再冲突。`create` / `resolveByPath` 只在主目录命中时复用或解析；仅作为额外文件夹持有的路径会创建新 Workspace。`setPrimaryFolder` 仍拒绝已是其他 Workspace 主目录的路径（`workspace-folder-conflict`）。`attachSession` 拒绝已被其他 Workspace 记账的会话（`WorkspaceSessionAccountedError`），否则共享额外文件夹会让一个 cwd 匹配多个账本。

多个 Workspace 同时拥有会话 cwd 时，`extraWorkspaceRoots` 只选其中一个——绝不取并集：记账了本会话的 Workspace，否则以该目录为主目录的，否则唯一归属方。共享额外目录既未记账也不是任何人的主目录时保持单根，不会因此授予另一个 Workspace 的目录。`sandbox:policy` 在 `read-only` 和 `danger-full-access` 下也会点名这些额外目录（`The session workspace also includes …`）。单目录 Workspace 仍发出与此前相同的句子。

磁盘记录和领域版本不变。额外文件夹仍不扩大 `AGENTS.md` 查找、`@` 提及搜索或 `fs-search` 默认根。

## Alternatives considered

**保持排他归属并增加转移 RPC。** 把文件夹从一个 Workspace 挪到另一个，仍无法表达「这个额外文件夹同时也是我另一个项目的主目录」。

**把所有匹配 Workspace 的额外根取并集。** 会话会写入它并未记账的目录。

**共享且未记账的额外文件夹按注册表顺序取第一个。** 共享额外目录会授予碰巧排在最前的那个 Workspace。

**让 `resolveByPath` 匹配额外文件夹。** 多个归属方会让返回值任意。

## Consequences

Workspace A 的额外文件夹可以再加进 Workspace B，也可以注册为 Workspace C 的主目录，而不必从 A 或 B 移除。在 C（或 A）仍把它当作主目录时，把它提升为 B 的主目录仍会失败。共享额外文件夹使 cwd 成员资格不再唯一，因此会话记账才是归属真源。仍强制额外文件夹排他的旧构建会在启动时拒绝共享额外文件夹的注册表。

## Testing

`packages/workspace/workspace/tests/workspace.spec.ts` 覆盖共享额外文件夹、在额外文件夹上创建、提升冲突、会话记账守卫和启动校验。`packages/host/apiproxy/tests/api-proxy-workspace.spec.ts` 覆盖线上的共享、在额外文件夹上创建以及 `setPrimaryFolder` 冲突。`packages/sandbox/sandbox-policy/tests/policy.spec.ts` 覆盖记账/主目录额外根选取、未记账仅额外文件夹的单根情形，以及 `read-only` / `danger-full-access` 下的额外文件夹句子。`packages/client/runtime/tests/workspaces-service.client.spec.ts` 覆盖 addFolder 非法路径和 setPrimaryFolder 冲突透传。
