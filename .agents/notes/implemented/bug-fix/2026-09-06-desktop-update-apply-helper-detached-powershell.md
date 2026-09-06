# Agent Note: Desktop update apply helper never ran under detached spawn

Status: implemented

English | [中文](2026-09-06-desktop-update-apply-helper-detached-powershell.zh.md)

## Problem

Clicking 重启并更新 in the packaged Windows desktop killed the Node host and nothing followed: the apply helper script was written, the route returned, the process exited — and the extract tree was never copied and `dsh-web.exe` never relaunched. The Settings row cannot show replace progress after that exit, so a silent helper also looks like a hang. The PowerShell event log for the failed session shows no engine start for the helper at all, so the script never executed a single statement.

## Decision

`spawn('powershell.exe', …, { detached: true, windowsHide: true })` starts Windows PowerShell 5.1 without a console, and on Windows 11 x64 it then exits with code 0 before executing `-File`. A plain powershell child can run `-File` while this process lives, but apply then `process.exit`s the packaged GUI host and that child dies with the tree. `cmd.exe start "title"` is not a substitute: `start` treats the quoted title as the file to open (`Windows cannot find 'dsh-desktop-update'`). Production writes `apply.vbs` beside the `.ps1` and spawns `wscript.exe //nologo apply.vbs` with `detached: true`, `stdio: 'ignore'`, and `windowsHide: true`. The VBS `WScript.Shell.Run`s Windows PowerShell 5.1 `-STA -File apply.ps1` hidden and without waiting, which both starts `-File` and outlives Node. The helper splash tracks wait-for-exit, wait-for-unlock, robocopy, and relaunch after the Host UI is gone; every step appends to `apply.log`; a failure raises a MessageBox. The `.ps1` is written with a UTF-8 BOM so Windows PowerShell 5.1 reads the Chinese splash strings; the `.vbs` is written UTF-16 LE with BOM. Robocopy is invoked with `&` and `$LASTEXITCODE` is captured without a pipeline. The apply route delays `process.exit` by one second after the apply response is committed. Ownership stays on the [packaged desktop GitHub update](../feature/2026-09-05-packaged-desktop-github-update.md) note.

## Alternatives considered

**Spawn powershell.exe as a plain child.** Rejected: it executes `-File` while this process lives, but apply then `process.exit`s the packaged GUI host, and a non-broken-away child disappears with that tree.

**Keep `detached: true` on powershell.exe.** Rejected: the engine never starts `-File` when the host has no console, which is the original failure.

**`cmd.exe /c start "title" /min powershell.exe -File`.** Rejected: `start` consumes the quoted title as the program name, so Windows searches for a file called `dsh-desktop-update` and never launches the helper.

**Byte-accurate copy percent in the Settings row.** Rejected: the Host exits before robocopy, so the row has no process to poll; robocopy also has no overall percent. The helper splash reports the four apply steps instead.

## Consequences

Restart-and-update shows a replace-progress splash, copies the product folder, and relaunches `dsh-web.exe`. A failed apply leaves `$DSH_HOME/desktop-update/apply.log` naming the first step that did not happen, and a MessageBox if WinForms loaded. `packages/host/desktop-update/tests/product-helper.spec.ts` pins the `wscript.exe` argv, VBS `Run` line, BOM, splash strings, and unpiped robocopy; `tests/routes.spec.ts` pins the delayed exit. There is no assembled snapshot of a real apply.
