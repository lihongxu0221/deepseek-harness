# Agent Note: 打包桌面的 `plugin` 参数必须走进 CLI

Status: implemented

[English](2026-08-20-packaged-desktop-plugin-cli.md) | 中文

## Problem

插件市场通过再拉起 `dsh plugin --profile web add …` 来安装。打包后的 Windows 桌面里，`dsh` 就是已经占用 `$DSH_HOME` 的那个 GUI 子系统可执行文件。第二次启动会走[单实例管道](../feature/2026-08-19-windows-packaged-desktop-tray.zh.md)的访客路径，发送 `show` 后以 0 退出，根本不会运行 pnpm。

市场把干净退出当成安装成功，随后发现没有可加载的新包，于是报「插件需要构建授权或未附带构建产物」。`desktop-host.log` 在失败安装的同一时刻记下 `role=guest`。`github:Small-tailqwq/dsh-deep-whale#path:/maid-atelier` 这类 git 皮肤，以及已经带 `lib/` 的 npm tarball，都会这样失败。master 没有桌面锁，那里的 `pnpm dsh plugin` 仍会转发给 pnpm。

## Decision

`lib/packaged-web-bin.js` 在应用打包后的 `$DSH_HOME` 之后检查额外 argv。第一个 token 是 CLI 头（`plugin`、`--profile`、`--help`、`--version`、`--dump-config` 及其短别名）时，它保持调用时的 cwd，并改写 `process.argv`，让 `lib/bin.js` 看到 CLI 调用，并动态导入磁盘上的该入口。只有 GUI 分支才会 `chdir` 到可执行文件目录。worker 脚本参数仍导入脚本；空额外 argv 仍启动 GUI；像 `--port` 这样的 web 内部旗标仍走桌面或访客 `show`，这样第二次双击不会再开一个 web profile。桌面启动还会带上 `--no-open`：web-app 的 Node `--eval` 助手会在 owner 启动约两秒后再把同一个 exe 拉成访客。Chromium 启动器若在 `DESKTOP_WINDOW_HANDOFF_MS` 内退出，不会忘掉当前 GUI，因此访客 `show`（或安装插件时再拉起这个 exe）会聚焦已有的 `--app=` 窗口，而不是再开一个。可执行文件名不是 `node` 时，改用 `cmd /c start`、`open` 或 `xdg-open`，而不是对 `process.execPath` 做 `--eval`。

`apps/cli/src/packaged-web-entry.ts` 里的 `packagedCliArgv` 和 `resolvePackagedCliEntry` 负责 token 判断，以及 exe 旁边的 `lib/bin.js` 路径。`extraPackagedArgv` 会先丢掉启动器槽位，以及 shell spawn 保留的调用回声（SEA 重写 argv[0] 之后留下的 `dsh`）；[shell-argv 说明](2026-08-22-packaged-plugin-shell-argv.zh.md)负责该跳过、PATH 前置、产品目录里的 `dsh` 别名，以及 `-e` 求值。

## Alternatives considered

**把所有额外 argv 都交给 CLI。** 否决：像 `--port` 这样的 web 内部旗标目前经由桌面启动到达打包 profile；`dsh web` 则会在没有托盘的情况下再起一个 web 服务器。

**提供 DSH Desktop 的 `desktopPnpm` 服务，让市场不再 spawn `dsh`。** 否决：宿主契约更大，也无法覆盖 GUI 已打开时用户在终端执行 `dsh plugin`。

**在 `dsh-web.exe` 旁边再放一个 CUI 的 `dsh.exe`。** 否决：已发布文件夹把同一个启动器当作 PATH 上的 `dsh`，市场的回退名正是它。

**让市场把访客的 exit 0 当成失败。** 否决：spawn 仍然必须跑 pnpm；识别锁只会改报错文案。

## Consequences

插件市场安装以及针对打包 exe 的 `dsh plugin --profile web add` 会在 `.config/profiles/<name>` 里跑 pnpm，GUI 仍是单实例管道的 owner。相对路径的 plugin 与 `--patch` 规格相对调用方 cwd 解析。`--profile`、帮助、版本和配置转储也会走进 CLI。双击和第二次 GUI 启动不变，打包桌面也不再另开一个默认浏览器助手。`apps/cli/tests/packaged-web-entry.spec.ts` 固定 CLI 头与 `--port` 的区分，以及 CLI 头不会 chdir；`apps/cli/tests/desktop-listen.spec.ts` 固定 `--no-open`；`packages/bundle/web-app/tests/web-app.spec.ts` 固定产品 exe 走操作系统 opener。
