# Agent Note: Packaged Web desktop executable

Status: implemented

[English](2026-08-18-packaged-web-desktop-exe.md) | 中文

## Problem

`dsh-jsonrpc-agent-pkg-*.exe` 是标准输入输出上的 JSON-RPC 服务器。双击它只会打印就绪行并等待 stdin。这对 Python SDK 载体是正确行为，但对想点击 exe 就使用 Web GUI 的人来说是错误的首次运行产品。

`pnpm dsh web` 已经是官方浏览器界面。要求用户保留源码目录并再跑一条命令，与打包桌面启动相反。

## Decision

另外发布 `dist-exe/dsh-web-<platform>-<arch>/` 作为第二个产品。`dsh-web` 是薄的 `@yao-pkg/pkg --sea` 启动器。Node 的 SEA 嵌入器按 CommonJS 运行该入口（`embedderRunCjs`），因此提交的是 `apps/cli/packaged-web-launcher.cjs`。它再动态导入同一文件夹里磁盘上的 `lib/packaged-web-bin.js`。若第一个额外参数是已存在的 `.js`/`.cjs`/`.mjs` 文件，启动器和该磁盘入口会导入该脚本而不是启动 GUI，这样 Win32 文件夹选择器的 `spawn(process.execPath, [worker.cjs])` 就会像 node 一样运行，并留在打包 ABI 上。pkg SEA 会把 exe 路径同时放进 `argv[0]` 和 `argv[1]`；选择脚本前会跳过这两个位置。导入前会把 argv 改写成 `[execPath, script, ...scriptArgs]`，让读取 `process.argv.slice(2)` 的 worker 只看到自己的参数（[worker argv 改写](../bug-fix/2026-08-23-packaged-worker-script-argv.zh.md)）。文件夹的其余部分是 `@deepseek-ai/dsh` 的 `pnpm deploy` 结果（`lib/`、`config/`、`node_modules/`）。部署之后，构建会补上 legacy hoister 和 `link:` override 漏掉的 workspace / vendor 包，包括 `dsh-fs` 这类 peer Service Definition。随后按钉扎列表把社区插件种进 `.config/profiles/web`（[内置 profile 插件](2026-08-23-packaged-builtin-profile-plugins.zh.md)）。整个文件夹才是产品；只复制 exe 会大声失败。

双击会启动随附的 `web` profile，再把回环 URL 在 Edge 或 Chrome 的 `--app` 窗口中打开，并使用独立的 `$DSH_HOME/desktop-chromium` 配置目录，让该窗口成为自己的进程。Windows 上由闪窗和托盘宿主接管生命周期（[Windows 闪窗与托盘](2026-08-19-windows-packaged-desktop-tray.zh.md)）：关闭应用窗口只隐藏界面，托盘退出才停止服务器。macOS 和 Linux 上，浏览器在 2 秒内退出视为启动器交接，服务器继续运行；关闭存活更久的应用窗口或控制台都会停止服务器。这些平台找不到 Chromium 浏览器时，改走操作系统打开方式，控制台仍是服务器。

打包入口在加载 `.env` 并启动之前，会把进程 cwd 改成可执行文件所在目录，因为资源管理器的 cwd 常常不是那个目录。若尚未设置 `$DSH_HOME`，接着会把它指向 `<exeDir>/.config` 并创建该目录。这个文件夹就是完整的 harness 主目录：`settings.yaml`、`.credentials.yaml`、会话和 `desktop-chromium`。源码启动的 `pnpm dsh` 不变，仍使用 `~/.dsh`。

`scripts/build-web-exe.ts` 和仓库根目录的 `build-exe.bat` 只生成这个 Web 文件夹。它们用 `@yao-pkg/pkg --sea` 打包薄启动器，用 `pnpm deploy --filter @deepseek-ai/dsh` 部署闭包，不会同步进 Python runtime，也不会跑 `verify-runtime-closure`。制品构建的子进程设置 `LEFTHOOK=0`，而不是 `CI=true`，因为 pnpm 10 会把 `CI=true` 当成运行 `pnpm install --production` 的信号，随后 lefthook 的 postinstall 就无法导入 lefthook。在 `rm` 掉 staging 或产品文件夹之前，构建会先把已有的 `.config` 拷到一边，完成后再拷回去，即使 deploy 或 pack 失败也会这样做。拷贝会跳过 `profiles/node_modules`，该安装回退目录由 `healProfilesModuleFallback` 在启动时重建。

JSON-RPC 旁边的 `cordis.yml` 约定保持不变。[单文件 JSON-RPC exe](../architecture/2026-07-10-single-file-executable-sdk-runtime-distribution.zh.md) 仍是 Python SDK 载体。

## Alternatives considered

**给 JSON-RPC exe 加上 HTTP。** 否决，因为那个 bin 是 Python SDK 的标准输入输出载体。把浏览器界面混进去会破坏就绪行约定和旁边配置文件的故事。

**把整个 Web GUI 打进一个 pkg SEA 文件。** 否决，因为 `healProfilesModuleFallback` 会在 `$DSH_HOME/profiles/node_modules` 下创建真实的包符号链接。`/snapshot` 路径不是真实文件系统，这些链接在 Windows 上会失败，插件也无法加载。

**用 ESM 文件作为 pkg SEA 入口。** 否决，因为单文件 ESM 启动器会被嵌入器按 CJS 执行，并以 `Cannot use import statement outside a module` 退出。JSON-RPC 产品靠快照整个包避开这个问题；本产品不能快照 GUI。

**Electron、Tauri 或 WebView2 宿主。** 否决，因为那会变成一个新的桌面产品。Chromium 应用模式打开的就是 CLI 已经提供的本地 URL，不需要第二套 UI 运行时。

**一个运行 `pnpm dsh web` 的批处理。** 否决，因为用户要求点击构建好的 exe，而不是继续依赖源码目录和 PATH。

**在所有平台隐藏控制台。** 否决用于 macOS 和 Linux：没有一直存在的 Chromium 窗口时，控制台仍是可见的服务器。Windows 隐藏控制台，并使用[闪窗与托盘宿主](2026-08-19-windows-packaged-desktop-tray.zh.md)。

**让 web Commander 接受多余的 worker 路径。** 否决，因为那仍会再启动一套 Web GUI，对话框 worker 根本不会运行。

**把 PATH 上的 `node` 当作打包产品的主路径。** 否决，因为另一个 Node 可能加载不了随附的 koffi 二进制。宿主 exe 不能跑脚本时，`$NODE_BINARY` / `$npm_node_execpath` 仍可作为显式覆盖。

**打包 exe 继续使用 `~/.dsh`。** 否决，因为生成的配置应放在程序旁边的 `.config` 中，作为 `~/.dsh` 的便携等价目录。

## Consequences

Windows 用户运行 `build-exe.bat`，然后双击 `dist-exe/dsh-web-win-x64/dsh-web.exe`。推送 `winexeBuilder` 或 `winexeNew` 会跑 `.github/workflows/winexe-desktop.yml`，把 `<package-version>.winexe.<GitHub run number>` 写入 `VERSION` 和 `README.txt`（不改 `package.json`），并发布预发布 zip。目标机器打开 GUI、对话、添加工作区或写入 API key 时不需要安装系统 Node.js 或 Python：启动器内嵌 Node，`node_modules/` 随文件夹分发，窗口使用 Edge 或 Chrome。Agent 调用的 `python` 或 `node` 命令以及 `dsh plugin` 仍需要这些宿主工具。此可执行文件上的 `plugin` argv 会进入 `lib/bin.js` 而不是桌面锁；见[打包插件 CLI 说明](../bug-fix/2026-08-20-packaged-desktop-plugin-cli.zh.md)。API key 来自「设置 → 模型」，会写入 `.config/.credentials.yaml`。再次构建会保留 `.config`。exe 旁边的 `.env` 仍可作为项目层使用。`apps/cli/tests/open-desktop-window.spec.ts`、`apps/cli/tests/packaged-web-entry.spec.ts`、`apps/cli/tests/packaged-web-home.spec.ts` 和 `scripts/preserve-packaged-web-home.spec.ts` 中的单元测试固定了 URL 拒绝规则、浏览器优先级、应用模式参数、`start`/`open`/`xdg-open` 回退、缺少文件夹时的错误、SEA 启动器必须保持为 CommonJS，worker 脚本额外参数会导入而不是启动 GUI，未设置、仅空白和显式 `$DSH_HOME` 的情况，重建删除后会恢复 `.config` 并跳过 `profiles/node_modules`，以及 Windows 打包会把 PE 子系统设为 GUI。
