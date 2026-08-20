# Agent Note: Windows packaged desktop splash and tray

Status: implemented

[English](2026-08-19-windows-packaged-desktop-tray.md) | 中文

## Problem

双击 `dsh-web.exe` 会打开控制台，并把该控制台当作可见的服务器。关闭 Chromium 窗口会结束进程。想要桌面产品的用户需要能报告启动进度的闪窗、加载完成后的主窗口，以及可显示界面、启动、停止或重启 Web 服务、更改监听地址、打开系统设置或退出的任务栏/托盘图标，而不再出现控制台。

## Decision

在 Windows 上，`lib/packaged-web-bin.js` 在 `applyPackagedWebHome` 之后调用 `runPackagedWebDesktop`。隐藏的 Windows PowerShell 5.1 STA 进程运行 `apps/cli/src/windows-desktop-shell.ps1` 中嵌入的 WinForms 脚本（复制进 `WINDOWS_DESKTOP_SHELL_SCRIPT`，因为 CLI 的 tsdown 打包不会附带同级 `.ps1`；编辑脚本后用 `apps/cli/scripts/embed-windows-desktop-shell.mjs` 重写该常量）。Node 与该宿主通过 JSON 行通信：宿主发送 `show` / `start` / `stop` / `restart` / `listen` / `settings` / `quit`；Node 发送 `progress` / `ready` / `state` / `listen` / `error` / `focus` / `quit`。

闪窗和托盘使用由 `apps/web/public/favicon.svg` 栅格化的鲸鱼 `.ico`。停止时为黑色（`apps/cli/assets/dsh-web.ico`），运行时为 DeepSeek 500 蓝 `#4176E6`（`apps/cli/assets/dsh-web-running.ico`）。Node 设置 `DSH_WEB_ICON` 与 `DSH_WEB_ICON_RUNNING`；宿主按小图标尺寸加载 `System.Drawing.Icon`，`SyncMenu` 根据 `$script:Running` 赋给 NotifyIcon。文件缺失时回退到 exe 关联图标，最后才是 `SystemIcons.Application`。Windows 打包会把两个文件复制到 `dsh-web.exe` 旁边。闪窗显示中英进度文本和百分比条，不出现在任务栏。`ready` 会隐藏闪窗并留下 NotifyIcon。启动与停止互斥：只有 Web profile 在运行时才启用停止和重启。**打开 http://ip:port** 仅在服务运行时启用；标签跟随当前监听地址，并用默认浏览器打开该 URL（`Start-Process`）。绑定 `0.0.0.0` 时，菜单使用 DNS 主机地址中的非回环 IPv4，没有则回退 `127.0.0.1`——浏览器打不开有用的 `http://0.0.0.0`。**监听地址…** 打开置顶的非模态 WinForms 窗口，可选 `127.0.0.1` 或 `0.0.0.0` 以及端口；Node 把选择持久化到 `$DSH_HOME/desktop-listen.json`，并在服务已运行时重启 profile。打包桌面会从该文件前置 `--host` / `--port`，且仅在 `0.0.0.0` 时设置 `DSH_WEB_ALLOW_ALL_INTERFACES=1`，因为 CLI 在没有该环境变量时仍拒绝该主机。**显示主界面** 即使服务器绑定所有网卡，仍打开 Chromium 应用窗口到 `http://127.0.0.1:<port>`。关闭 Chromium 窗口只会忘掉该窗口，不会销毁 profile；显示主界面会重新打开回环 URL，系统设置则带上 `#settings`。`SettingsRoot` 在 hash 为 `#settings` 时打开设置面板，关闭面板时清掉 hash。托盘退出会停止 profile 并退出 Node。托盘进程意外退出时，按 `TRAY_RESTART_DELAYS_MS` 退避重启 WinForms 宿主，并追加 `$DSH_HOME/desktop-host.log`；无论如何 Node 都继续提供服务，因此起不来的托盘只会退化成无界面服务器，而不是每秒重复弹几次窗口。

三条 PowerShell 托管规则维持该宿主存活，每一条在修好之前都会造成无法解释的退出：

- **Node 的 JSON 行由异步 `StreamReader` 经 WinForms 计时器轮询读取，绝不使用运行 scriptblock 的 `System.Threading.Thread`。** 原生线程没有附加 runspace，引擎会直接拆掉进程而不是抛出可捕获的错误：退出码 2、stderr 为空，且 `trap` / `catch` / `finally` 全部跳过。
- **事件处理器读取的每个控件都置于 `$script:` 作用域。** 处理器在 `ShowListenDialog` 返回很久之后才运行，而 PowerShell 在函数返回时丢弃其局部作用域，被捕获的局部变量读回来是 `$null`，对其调用方法即报 `不能对 Null 值表达式调用方法`。
- **`SetUnhandledExceptionMode(CatchException)` 配合 `ThreadException` 处理器，把故障通过气泡提示上报。** 否则 WinForms 会弹出自带的未处理异常对话框，其「退出」按钮会杀掉托盘。

宿主脚本写入 `$DSH_HOME` 而非 `%TEMP%`：临时目录与机器上所有其他进程共享，也是终端防护扫描最激进的目录，而正在运行的 PowerShell 下脚本被删除或加锁会杀掉托盘。文件名带上父进程 pid 与时间戳，因此重启永不会 unlink 它正在替换的那个宿主的脚本。

`scripts/build-web-exe.ts` 把 Windows 启动器的 PE 子系统设为 GUI，资源管理器不会再附加控制台。第二个使用同一 `$DSH_HOME`、且没有 `plugin` argv 的进程会以访客身份占用 named pipe，发送 `show` 后退出。`plugin` argv 的分发见[打包插件 CLI 说明](../bug-fix/2026-08-20-packaged-desktop-plugin-cli.md)。owner 在该管道上只接受 `show`；start、stop、listen 和 quit 仍走托盘 stdin。macOS 和 Linux 仍使用[打包 Web 桌面可执行文件](2026-08-18-packaged-web-desktop-exe.md)说明里的控制台托管路径。

## Alternatives considered

**Windows 上继续把控制台当作可见服务器。** 否决，因为面向用户的要求是闪窗、主窗口和托盘菜单。加载完成后，托盘图标就是可见的服务器。

**隐藏控制台且不显示闪窗。** 否决，因为启动慢或失败时，双击会看起来什么都没发生。闪窗用来报告进度和错误；之后的失败由托盘气泡报告。

**Electron、Tauri 或 WebView2。** 在打包 exe 的说明里已否决：产品仍然是应用模式 Chromium 中的本地 Web GUI。

**用 Node 原生托盘 addon。** 否决，因为每台 Windows 主机都有 WinForms NotifyIcon，JSON 行 PowerShell 宿主也让 Node 打包不必再带额外原生依赖。

**用 pwsh 7 做托盘宿主。** 否决，因为 WinForms STA 托管是 Windows PowerShell 5.1 的约定。启动路径始终是 `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`。

**把系统设置做成只显示主界面。** 否决，因为托盘项是「系统设置」/ Settings。`#settings` 就是宿主已经打开的深链。

**把监听主机和端口放进 Web 设置面板。** 否决，因为服务可能已停止，而且改绑定需要托盘已经拥有的重启。

**放开 CLI 对 `--host 0.0.0.0` 的拒绝。** 否决，因为该 flag 仍会把远程代码执行暴露到网络上，影响 `dsh --profile web`。打包桌面才是需要局域网绑定的产品，它通过环境变量白名单来做。

## Consequences

Windows 打包产品的生命周期不再绑在 Chromium 窗口或控制台上。用户从托盘停止、重启并重新绑定产品。WinForms 进程退出时 Node 宿主继续运行。即使没有 Chromium 浏览器，服务仍会启动；显示主界面随后走 `cmd start`，托盘保留。`apps/cli/tests/windows-desktop-shell.spec.ts`、`apps/cli/tests/desktop-listen.spec.ts` 和 `apps/cli/tests/packaged-web-desktop.spec.ts` 固定了 JSON 行协议、嵌入脚本、启动/停止/重启、打开 URL 托盘项、鲸鱼 `.ico`、持久化监听、`#settings`、访客 `show`、单实例管道忽略 `quit` 和 `listen`、关闭窗口不会退出、重启退避，以及三条 PowerShell 托管规则：处理器可见控件的 `$script:` 作用域、不使用运行 scriptblock 的原生线程、以及被捕获的 WinForms 线程异常。`packages/bundle/web-app/tests/startup.spec.ts` 固定了全接口环境变量白名单。`packages/client/ui-settings-general/tests/settings-root.client.spec.tsx` 固定了 hash 深链。WinForms 闪窗和托盘没有组装应用快照：这些窗口不在 Web e2e harness 里。
