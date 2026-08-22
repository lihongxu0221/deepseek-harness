# Agent Note: shell 按名称拉起 `dsh` 时，打包形态的插件安装死在 GUI 访客路径

Status: implemented

[English](2026-08-22-packaged-plugin-shell-argv.md) | 中文

## Problem

[2026-08-20 的 CLI 头分发](2026-08-20-packaged-desktop-plugin-cli.zh.md)跳过启动器自身槽位时，拿其余 argv 项与 argv[0] 比较。插件市场在 Windows 的回退路径是 `cmd /d /s /c "dsh plugin --profile web add …"`，而 SEA 在入口运行前重写了 argv：argv[0] 变成绝对可执行路径，按输入原样的 token——`dsh`——被保留到下一个槽位。跳过逻辑认不出这个回声，`packagedCliArgv` 把 `dsh`（而不是 `plugin`）当作头，整个调用落进桌面访客路径——发送 `show`、以 0 退出、pnpm 从未运行。市场把干净退出当作成功，复查已安装版本后报 `STALE(release-age)`；owner 持续运行期间，`desktop-host.log` 每次尝试记下一行 `role=guest`。（追踪证据：SEA 内 `cmd /c dsh --version` 得到 `argv = [<exe>, "dsh", "--version"]`。）

这个失败之上还叠着两个打包形态独有的问题。发布文件夹不在用户 PATH 上，同样的 `cmd /c dsh …` 与市场的重启回放（PowerShell 下的 `& 'dsh'`）在默认机器上根本解析不到可执行文件。另外，市场的重启助手以 `nodeExecutable()` 加 `['-e', <源码>]` 拉起进程；打包宿主里 `process.argv0` 就是产品 exe，于是助手进程走了桌面访客路径，助手源码从未执行——重启杀掉宿主后再也没有拉起替代进程（临时目录下 `dsh-market-restart-*.err.log` 里的 `the replacement did not bind port … within 20s`）。

## Decision

`apps/cli/src/packaged-web-entry.ts` 的 `extraPackagedArgv` 与 `apps/cli/packaged-web-launcher.cjs` 中的副本现在会跳过作为调用回声的前导项（`isInvocationEcho`）：不以 `-` 开头，且解析后等于 `process.execPath`，或主干名与可执行文件一致，或主干名是 `dsh` / `dsh-web`（产品 exe 与市场的 PATH 名）。它们也会跳过 exe 旁边的 `lib/bin.js`，这样已经把 CLI 入口当作参数传入的 spawn 仍能看到 `plugin`。GUI owner 不会把 `process.argv[1]` 改写成 `lib/bin.js`：否则 `dshArgv()` 会带着该路径 spawn 本可执行文件，SEA 会把 `bin.js` 当 worker 导入，`process.argv.slice(2)` 里仍留着文件路径，根解析器就会报 `--profile <name> is required`，而不是去跑 `plugin`。空白 `cmd.exe` 窗口靠下面的启动器包装隐藏，而不是入口层补丁。`lib/packaged-web-bin.js` 在任何分支之前把可执行文件所在目录前置到 `env.PATH`（仅 win32，按目录幂等），子进程按名称调用 `dsh` 即可解析。打包步骤会把启动器复制为 `dsh-web` 旁边的 `dsh.exe`（Windows）或 `dsh`（POSIX），因为 PATH 前置只有在该文件存在时才有用。入口对 `-e`/`--eval <源码>` 求值：写入临时 `.cjs` 后导入——与既有脚本文件参数授予的能力相同——源码抛错时退出码置 1，导入结束后删除临时文件。`apps/cli/src/plugin.ts` 给 pnpm 的 `spawnSync` 加上 `windowsHide: true`，父进程是 GUI 子系统 exe 时，Windows 的 `.cmd` 垫片不会再弹出第二个空白控制台。内嵌的 CJS 启动器（`packaged-web-launcher.cjs`）还会在 win32 上给 `child_process.spawn` / `spawnSync` 包一层 `windowsHide`，但只针对控制台宿主（`cmd`、`powershell`、`pwsh`、`.cmd`/`.bat`，或 `shell: true`）。一律隐藏会连 Edge/Chrome 的 `--app` 一起藏掉，主窗口就出不来。这层包装必须放在启动器里：入口包的静态 ESM import 会提升到任何入口层补丁之前，而 `node:child_process` 的 ESM 门面在首次导入时就把当时的 CJS 导出快照下来了。

## Alternatives considered

**只按 argv[0] 匹配，维持原状。** 否决：直接 spawn 正常，但所有 cmd/PowerShell spawn 全部漏掉，而市场的 Windows shim 路由恰恰是 cmd。

**让市场直接 spawn 绝对路径可执行文件。** 否决：`dshArgv()` 是市场自己的代码，从它的 argv 回退到 PATH 名称；本仓库改不了它，缺失的 PATH 条目也仍会打断重启回放。

**把 GUI 的 `argv[1]` 改成 `lib/bin.js`，让 `dshArgv()` 直接 spawn exe、不走 cmd。** 否决：SEA 会把 `bin.js` 当 worker 导入，`parseDshArgs(process.argv.slice(2))` 把文件路径当成用户参数，于是报 `--profile <name> is required`。

**只修内嵌的 CJS 启动器。** 否决：磁盘入口在导入后会重新计算额外 argv；两份副本拥有同一个跳过逻辑，必须保持对称。

## Consequences

打包应用里的 `cmd /c dsh plugin …` 现在会分发到 CLI 并对 `.config/profiles/web` 运行 pnpm，市场的安装与更新可以落地。市场在进程内的 spawn 在 Windows 上仍走 `cmd /c dsh`，控制台被隐藏。市场的重启助手在打包 exe 下执行自己的源码，重启回放通过注入的 PATH 条目解析 `dsh` 并以管道 owner 身份启动。`apps/cli/tests/packaged-web-entry.spec.ts` 固定了 shell token 跳过、`lib/bin.js` 跳过、PATH 前置、eval 源码解析，以及启动器只隐藏控制台的包装；打包桌面的 README 章节记录了这些行为。
