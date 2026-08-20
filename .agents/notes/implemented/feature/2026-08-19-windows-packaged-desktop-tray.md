# Agent Note: Windows packaged desktop splash and tray

Status: implemented

English | [中文](2026-08-19-windows-packaged-desktop-tray.zh.md)

## Problem

Double-clicking `dsh-web.exe` opened a console and treated that console as the visible server. Closing the Chromium window stopped the process. Users who want a desktop product need a splash that reports boot progress, a main window after load, and a taskbar/tray icon that can show the GUI, start, stop, or restart the web service, change the listen address, open Settings, or exit — without a console.

## Decision

On Windows, `lib/packaged-web-bin.js` calls `runPackagedWebDesktop` after `applyPackagedWebHome`. A hidden Windows PowerShell 5.1 STA process runs the embedded WinForms script in `apps/cli/src/windows-desktop-shell.ps1` (copied into `WINDOWS_DESKTOP_SHELL_SCRIPT` because the CLI tsdown bundle does not ship sibling `.ps1` files; `apps/cli/scripts/embed-windows-desktop-shell.mjs` rewrites the constant after a script edit). Node and the host speak JSON lines: the host sends `show` / `start` / `stop` / `restart` / `listen` / `settings` / `quit`; Node sends `progress` / `ready` / `state` / `listen` / `error` / `focus` / `quit`.

The splash and tray use whale `.ico` files rasterized from `apps/web/public/favicon.svg`. Stopped is black (`apps/cli/assets/dsh-web.ico`); running is DeepSeek 500 blue `#4176E6` (`apps/cli/assets/dsh-web-running.ico`). Node sets `DSH_WEB_ICON` and `DSH_WEB_ICON_RUNNING`; the host loads small-icon-sized `System.Drawing.Icon`s and `SyncMenu` assigns the NotifyIcon from `$script:Running`. Missing files fall back to the exe associated icon, then `SystemIcons.Application`. The Windows pack copies both files beside `dsh-web.exe`. The splash window shows bilingual progress text and a percent bar and is not on the taskbar. `ready` hides it and leaves the NotifyIcon. Start and Stop are mutually exclusive: Stop and Restart are enabled only while the web profile is running. **Open http://ip:port** is enabled only while running; its label tracks the current listen address and opens that URL in the default browser (`Start-Process`). When the bind is `0.0.0.0`, the item uses a non-loopback IPv4 from DNS host addresses, or `127.0.0.1` if none exist — browsers do not usefully open `http://0.0.0.0`. **Listen address…** opens a modeless TopMost WinForms window for `127.0.0.1` or `0.0.0.0` plus a port; Node persists the choice as `$DSH_HOME/desktop-listen.json` and restarts the profile when it is already running. The packaged desktop prepends `--host` / `--port` from that file and sets `DSH_WEB_ALLOW_ALL_INTERFACES=1` only for `0.0.0.0`, because the CLI still rejects that host without the env. **Show** still opens the Chromium app window at `http://127.0.0.1:<port>` even when the server binds all interfaces. Closing the Chromium window forgets that window and does not dispose the profile; Show reopens the loopback URL, and Settings reopens it with `#settings`. `SettingsRoot` opens the settings panel when the hash is `#settings` and clears the hash when the panel closes. Tray Exit stops the profile and exits Node. An unexpected tray-process death relaunches the WinForms host on the `TRAY_RESTART_DELAYS_MS` backoff and appends `$DSH_HOME/desktop-host.log`; Node keeps serving either way, so a tray that cannot stay up degrades to a headless server instead of a window that reappears several times a second.

Three PowerShell hosting rules keep that host alive, each of which produced an unexplained exit before it was fixed:

- **Node's JSON lines are read by an async `StreamReader` polled from a WinForms timer, never by a `System.Threading.Thread` running a scriptblock.** A raw thread has no runspace attached, so the engine tears the process down instead of raising a catchable error: exit code 2 with empty stderr, and `trap` / `catch` / `finally` all skipped.
- **Every control an event handler reads lives at `$script:` scope.** A handler runs long after `ShowListenDialog` returned and PowerShell discards the function's locals on return, so a captured local reads back as `$null` and the method call on it raises `cannot call a method on a null-valued expression`.
- **`SetUnhandledExceptionMode(CatchException)` plus a `ThreadException` handler reports faults through the balloon.** Otherwise WinForms raises its own unhandled-exception dialog, whose Quit button kills the tray.

The host script is written to `$DSH_HOME`, not `%TEMP%`: a temp path is shared with every other process on the machine and is the directory endpoint protection scans most aggressively, and a script deleted or locked under a running PowerShell kills the tray. The filename carries the parent pid and a timestamp so a relaunch never unlinks the script of the host it is replacing.

`scripts/build-web-exe.ts` sets the Windows launcher PE subsystem to GUI so Explorer does not attach a console. A second process with the same `$DSH_HOME` claims the named pipe as a guest, sends `show`, and exits. The owner accepts only `show` on that pipe; start, stop, listen, and quit stay on the tray stdin. macOS and Linux keep the console-hosted packaged path from the [packaged Web desktop executable](2026-08-18-packaged-web-desktop-exe.md) note.

## Alternatives considered

**Keep the console as the visible server on Windows.** Rejected because the user-facing request is a splash, a main window, and a tray menu. The tray icon is the visible server after load.

**Hide the console with no splash.** Rejected because a slow or failed boot would look like a no-op double-click. The splash exists to report progress and errors; tray balloons report later failures.

**Electron, Tauri, or WebView2.** Rejected in the packaged-exe note: the product is still the local Web GUI in app-mode Chromium.

**A Node native tray addon.** Rejected because WinForms NotifyIcon is already on every Windows host, and the JSON-line PowerShell host keeps the Node bundle free of extra native dependencies.

**pwsh 7 for the tray host.** Rejected because WinForms STA hosting is the Windows PowerShell 5.1 contract. The spawn path is always `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`.

**Settings as Show only.** Rejected because the tray item is 系统设置 / Settings. `#settings` is the deep link the host already opens.

**Put listen host and port in the Web Settings panel.** Rejected because the service may be stopped, and changing the bind requires a restart the tray already owns.

**Lift the CLI `--host 0.0.0.0` rejection.** Rejected because that flag still exposes remote code execution on the network for `dsh --profile web`. The packaged desktop is the one product that asks for LAN bind, and it does so through the env allow-list.

## Consequences

Windows packaged lifetime is no longer tied to the Chromium window or a console. Users stop, restart, and rebind the product from the tray. The Node host stays up if the WinForms process dies. A missing Chromium browser still starts the service; Show then uses `cmd start` and the tray remains. Tests in `apps/cli/tests/windows-desktop-shell.spec.ts`, `apps/cli/tests/desktop-listen.spec.ts`, and `apps/cli/tests/packaged-web-desktop.spec.ts` pin the JSON-line protocol, the embedded script, start/stop/restart, the Open-URL tray item, the whale `.ico`, persisted listen, `#settings`, guest `show`, that the single-instance pipe ignores `quit` and `listen`, that window close does not exit, the restart backoff, and the three PowerShell hosting rules: `$script:` scope for handler-visible controls, no raw thread running a scriptblock, and the caught WinForms thread exception. `packages/bundle/web-app/tests/startup.spec.ts` pins the all-interfaces env allow-list. `packages/client/ui-settings-general/tests/settings-root.client.spec.tsx` pins the hash deep link. There is no assembled-application snapshot of the WinForms splash or tray: those windows are outside the Web e2e harness.
