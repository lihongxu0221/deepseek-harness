# Agent Note: Packaged executable sidecar default cordis.yml

Status: implemented

[English](2026-08-17-packaged-exe-sidecar-default-cordis-yml.md) | 中文

## Problem

打包后的 JSON-RPC 可执行文件在没有 `$DSH_CORDIS_CONFIG` 或 argv 路径时拒绝启动。这对通用 bin、node 载体，以及会注入检入默认配置的 Python SDK 是正确约定。但对直接启动 `dsh-jsonrpc-agent-pkg-*.exe` 的人来说，这是错误的首次运行体验：资源管理器和空 shell 不会提供配置，进程只打印用法并以 1 退出。

隐藏的 exe 内回退同样错误。[single-exe 分发](../architecture/2026-07-10-single-file-executable-sdk-runtime-distribution.md) 仍然要求实际启动的插件列表来自外部 `cordis.yml`。

## Decision

`$DSH_CORDIS_CONFIG` 仍然优先于 argv。已指定但不存在的路径仍然立即失败，且不会被创建。

未打包的 `dsh-jsonrpc-agent` 启动和 Python node 载体仍然要求显式路径。

打包后的可执行文件——Node `isSea()` 或文件名以 `dsh-jsonrpc-agent-pkg` 开头——在两个通道都为空时使用 `<executable-dir>/cordis.yml`。若该文件不存在，进程写入捆绑的默认插件列表（条目与 `python/sdk-runtime/src/deepseek_harness_runtime/runtime/cordis.yml` 相同），并在 stderr 报告这次写入。写入失败是致命错误。

该启动还会从可执行文件目录加载 `.env` 且不覆盖已有变量，并把未设置的 `DSH_CWD` / `DSH_SESSION_ROOT` 默认到可执行文件目录和 `<executable-dir>/.sessions`。资源管理器的进程 cwd 不是可执行文件目录，所以这些默认值让生成的文件可以实际使用。

Python SDK 仍通过 `DSH_CORDIS_CONFIG` 注入其检入的默认配置，因此 SDK 启动不会走这条路径。

## Alternatives considered

**没有磁盘文件的隐藏 exe 内回退。** 否决，因为实际启动的插件列表必须仍是用户可编辑的外部 `cordis.yml`，静默默认会把该文件藏起来。

**工作目录下的 `./cordis.yml`。** 否决，因为资源管理器启动时的 cwd 常常是 `System32` 或用户主目录，而不是可执行文件目录，且未打包启动必须保持显式。

**为缺失的 env/argv 路径创建文件。** 否决，因为指定路径就是在请求那个文件；凭空创建会掩盖拼写错误。

**为 node 载体写到 `node.exe` 旁边。** 否决，因为该载体是系统 Node 加上 `packaged-bin.js`，配置会落到 Node 安装目录或调用方偶然的 cwd。

## Consequences

无参数运行打包后的可执行文件会在其旁边创建可编辑的 `cordis.yml` 并启动该文件。Python SDK、CI 和未打包 bin 仍保持显式配置约定。首次启动到 Program Files 这类只读目录时会立即失败，而不会捏造内存中的默认配置。`packages/examples/jsonrpc-demo/tests/config-path.spec.ts` 中的单元测试固定了发现规则、写入失败、启动目录默认值，以及与 Python 默认配置的插件条目一致性。
