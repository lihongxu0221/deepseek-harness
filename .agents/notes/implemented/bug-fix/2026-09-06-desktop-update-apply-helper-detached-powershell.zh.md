# Agent Note：桌面更新 apply 助手在 detached 启动下从未运行

Status: implemented

[English](2026-09-06-desktop-update-apply-helper-detached-powershell.md) | 中文

## Problem

在打包 Windows 桌面里点击“重启并更新”后 Node 宿主被杀且没有任何后续：apply 助手脚本已写入、路由已返回、进程已退出——但解压树从未被拷贝，`dsh-web.exe` 也从未重启。设置行在该退出之后无法再画替换进度，因此静默的 helper 看起来像假死。失败会话的 PowerShell 事件日志里完全没有助手的引擎启动记录，说明脚本一条语句都没有执行。

## Decision

`spawn('powershell.exe', …, { detached: true, windowsHide: true })` 在无控制台状态下启动 Windows PowerShell 5.1，在 Windows 11 x64 上它会在执行 `-File` 之前以退出码 0 退出。普通 powershell 子进程在本进程还活着时能执行 `-File`，但 apply 随后会 `process.exit` 打包 GUI 宿主，该子进程随进程树一起消失。`cmd.exe start "title"` 不能替代：`start` 把引号标题当成要打开的文件（`Windows 找不到文件 'dsh-desktop-update'`）。生产在 `.ps1` 旁写入 `apply.vbs`，并以 `detached: true`、`stdio: 'ignore'`、`windowsHide: true` 启动 `wscript.exe //nologo apply.vbs`。VBS 用 `WScript.Shell.Run` 隐藏、不等待地启动 Windows PowerShell 5.1 `-STA -File apply.ps1`，这样既会执行 `-File`，也能在 Node 退出后继续运行。helper 启动画面在 Host UI 消失后报告等待退出、等待解锁、robocopy 与重启；每一步追加到 `apply.log`；失败时弹出 MessageBox。`.ps1` 带 UTF-8 BOM，以便 Windows PowerShell 5.1 读出中文启动画面字符串；`.vbs` 以带 BOM 的 UTF-16 LE 写入。robocopy 用 `&` 调用，`$LASTEXITCODE` 不走管道。apply 路由在提交 apply 响应后延迟一秒再 `process.exit`。协议归属保持在[打包桌面 GitHub 更新](../feature/2026-09-05-packaged-desktop-github-update.zh.md)笔记。

## Alternatives considered

**把 powershell.exe 当普通子进程启动。** 拒绝：本进程还在时它能执行 `-File`，但 apply 随后会 `process.exit` 打包 GUI 宿主，未拆开的子进程随该进程树一起消失。

**继续对 powershell.exe 使用 `detached: true`。** 拒绝：宿主没有控制台时引擎从不启动 `-File`，这正是原来的失败。

**`cmd.exe /c start "title" /min powershell.exe -File`。** 拒绝：`start` 把引号标题当成程序名，于是 Windows 去找名为 `dsh-desktop-update` 的文件，助手从未启动。

**在设置行里画按字节的拷贝百分比。** 拒绝：Host 在 robocopy 之前就退出，该行没有可轮询的进程；robocopy 也没有总体百分比。helper 启动画面改为报告四个 apply 步骤。

## Consequences

重启并更新会显示替换进度启动画面、拷贝产品目录并重启 `dsh-web.exe`。失败的 apply 会在 `$DSH_HOME/desktop-update/apply.log` 里留下第一个未发生的步骤，若 WinForms 已加载还会弹出 MessageBox。`packages/host/desktop-update/tests/product-helper.spec.ts` 钉住 `wscript.exe` argv、VBS `Run` 行、BOM、启动画面字符串和未管道化的 robocopy；`tests/routes.spec.ts` 钉住延迟退出。没有真实 apply 的组装快照。
