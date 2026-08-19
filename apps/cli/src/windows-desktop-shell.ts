/**
 * Windows splash and tray host for the packaged Web desktop.
 * A hidden PowerShell 5.1 STA process runs WinForms; Node talks JSON lines
 * over stdin/stdout. The script is embedded because the CLI tsdown bundle
 * does not copy sibling .ps1 files.
 * @module @deepseek-ai/dsh/windows-desktop-shell
 */

import { spawn } from 'node:child_process'
import { existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDesktopListen, type DesktopListen } from './desktop-listen.ts'

/** Commands the tray host sends to Node. */
export type ShellToHost =
  | { type: 'show' }
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'restart' }
  | { type: 'settings' }
  | { type: 'listen'; host: DesktopListen['host']; port: number }
  | { type: 'quit' }

/** Commands Node sends to the tray host. */
export type HostToShell =
  | { type: 'progress'; text: string; zh?: string; percent?: number }
  | { type: 'ready' }
  | { type: 'state'; running: boolean }
  | { type: 'listen'; host: string; port: number }
  | { type: 'error'; text: string; zh?: string }
  | { type: 'focus'; pid?: number }
  | { type: 'quit' }

const SHELL_TO_HOST_TYPES = new Set(['show', 'start', 'stop', 'restart', 'settings', 'listen', 'quit'])

/** Packaged Windows desktop icon filename, next to `dsh-web.exe` and under `apps/cli/assets/`. */
export const DSH_WEB_ICON_FILENAME = 'dsh-web.ico'

/**
 * Locate the whale `.ico` for the splash and tray.
 * Packaged layouts keep it beside the exe; source / bundled CLI layouts keep
 * it at `apps/cli/assets/dsh-web.ico` relative to this module.
 * @param execPath - packaged executable path.
 * @returns the first existing candidate, or `undefined`.
 */
export function resolveDesktopIconPath(execPath: string): string | undefined {
  const candidates = [
    join(dirname(execPath), DSH_WEB_ICON_FILENAME),
    join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', DSH_WEB_ICON_FILENAME),
  ]
  return candidates.find(path => existsSync(path))
}

/** Embedded splash/tray script. Written to a temp file at spawn with a UTF-8 BOM. */
export const WINDOWS_DESKTOP_SHELL_SCRIPT = "# DeepSeek Harness packaged Web desktop splash + tray host.\n# Node speaks JSON lines on stdin; this process replies with JSON lines on stdout.\n$ErrorActionPreference = 'Stop'\n[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false\n[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false\nAdd-Type -AssemblyName System.Windows.Forms\nAdd-Type -AssemblyName System.Drawing\n[System.Windows.Forms.Application]::EnableVisualStyles()\n# A fault inside a WinForms event handler otherwise raises the \"unhandled\n# exception\" dialog whose Quit button kills the tray. Route those faults to the\n# balloon instead so the tray survives a bad click.\n[System.Windows.Forms.Application]::SetUnhandledExceptionMode([System.Windows.Forms.UnhandledExceptionMode]::CatchException)\n[System.Windows.Forms.Application]::add_ThreadException({\n  param($sender, $e)\n  try {\n    if ($null -ne $script:Notify) {\n      $script:Notify.BalloonTipTitle = 'DeepSeek Harness'\n      $script:Notify.BalloonTipText = $e.Exception.Message\n      $script:Notify.ShowBalloonTip(4000)\n    }\n  } catch { }\n})\n\n$script:IsZh = [System.Globalization.CultureInfo]::CurrentUICulture.TwoLetterISOLanguageName -eq 'zh'\nfunction T($zh, $en) {\n  if ($script:IsZh) { return $zh }\n  return $en\n}\n\nfunction PickText($msg) {\n  if ($script:IsZh -and $null -ne $msg.zh -and [string]$msg.zh -ne '') {\n    return [string]$msg.zh\n  }\n  if ($null -ne $msg.text) { return [string]$msg.text }\n  return ''\n}\n\n$script:Running = $false\n$script:ListenHost = '127.0.0.1'\n$script:ListenPort = 3080\n$script:ListenForm = $null\n$script:ListenBindBox = $null\n$script:ListenPortBox = $null\n\ntry {\nAdd-Type -TypeDefinition @\"\nusing System;\nusing System.Runtime.InteropServices;\npublic static class DshNative {\n  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);\n  [DllImport(\"user32.dll\")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);\n  [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);\n  [DllImport(\"user32.dll\")] public static extern bool IsWindowVisible(IntPtr hWnd);\n  [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd);\n  [DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);\n  [DllImport(\"user32.dll\")] public static extern bool IsIconic(IntPtr hWnd);\n  public const int SW_RESTORE = 9;\n  public const int SW_SHOW = 5;\n}\n\"@\n} catch {\n  if ($_.Exception.Message -notmatch 'DshNative') { throw }\n}\n\nfunction Emit($obj) {\n  $json = ($obj | ConvertTo-Json -Compress)\n  [Console]::Out.WriteLine($json)\n  [Console]::Out.Flush()\n}\n\nfunction FocusPid([int]$ProcessId) {\n  if ($ProcessId -le 0) { return }\n  $script:Target = [IntPtr]::Zero\n  $cb = [DshNative+EnumWindowsProc] {\n    param([IntPtr]$hWnd, [IntPtr]$lParam)\n    $wndPid = 0\n    [void][DshNative]::GetWindowThreadProcessId($hWnd, [ref]$wndPid)\n    if (($wndPid -eq $ProcessId) -and [DshNative]::IsWindowVisible($hWnd)) {\n      $script:Target = $hWnd\n      return $false\n    }\n    return $true\n  }\n  [void][DshNative]::EnumWindows($cb, [IntPtr]::Zero)\n  if ($script:Target -ne [IntPtr]::Zero) {\n    if ([DshNative]::IsIconic($script:Target)) {\n      [void][DshNative]::ShowWindow($script:Target, [DshNative]::SW_RESTORE)\n    }\n    [void][DshNative]::ShowWindow($script:Target, [DshNative]::SW_SHOW)\n    [void][DshNative]::SetForegroundWindow($script:Target)\n  }\n}\n\nfunction LoadDesktopIcon {\n  $candidates = @()\n  if ($env:DSH_WEB_ICON) { $candidates += [string]$env:DSH_WEB_ICON }\n  if ($env:DSH_WEB_EXE) {\n    $exeDir = [System.IO.Path]::GetDirectoryName([string]$env:DSH_WEB_EXE)\n    if ($exeDir) { $candidates += (Join-Path $exeDir 'dsh-web.ico') }\n  }\n  $small = [System.Windows.Forms.SystemInformation]::SmallIconSize\n  foreach ($path in $candidates) {\n    if (-not $path -or -not (Test-Path -LiteralPath $path)) { continue }\n    try {\n      return New-Object System.Drawing.Icon($path, $small.Width, $small.Height)\n    } catch {\n      # Unreadable ico files fall through to the exe associated icon.\n    }\n  }\n  if ($env:DSH_WEB_EXE) {\n    try {\n      $extracted = [System.Drawing.Icon]::ExtractAssociatedIcon($env:DSH_WEB_EXE)\n      if ($extracted) { return $extracted }\n    } catch {\n      # ExtractAssociatedIcon fails on some paths; keep SystemIcons.Application.\n    }\n  }\n  return [System.Drawing.SystemIcons]::Application\n}\n$icon = LoadDesktopIcon\n\n$splash = New-Object System.Windows.Forms.Form\n$splash.Text = 'DeepSeek Harness'\n$splash.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog\n$splash.MaximizeBox = $false\n$splash.MinimizeBox = $false\n$splash.ControlBox = $false\n$splash.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen\n$splash.ClientSize = New-Object System.Drawing.Size(460, 150)\n$splash.TopMost = $true\n$splash.ShowInTaskbar = $false\n$splash.Icon = $icon\n$splash.BackColor = [System.Drawing.Color]::White\n\n$title = New-Object System.Windows.Forms.Label\n$title.Location = New-Object System.Drawing.Point(20, 16)\n$title.Size = New-Object System.Drawing.Size(420, 28)\n$title.Font = New-Object System.Drawing.Font('Segoe UI', 12, [System.Drawing.FontStyle]::Bold)\n$title.Text = 'DeepSeek Harness'\n$splash.Controls.Add($title)\n\n$label = New-Object System.Windows.Forms.Label\n$label.Location = New-Object System.Drawing.Point(20, 48)\n$label.Size = New-Object System.Drawing.Size(420, 36)\n$label.Font = New-Object System.Drawing.Font('Segoe UI', 10)\n$label.Text = (T '正在启动…' 'Starting…')\n$splash.Controls.Add($label)\n\n$bar = New-Object System.Windows.Forms.ProgressBar\n$bar.Location = New-Object System.Drawing.Point(20, 100)\n$bar.Size = New-Object System.Drawing.Size(420, 22)\n$bar.Minimum = 0\n$bar.Maximum = 100\n$bar.Value = 8\n$bar.Style = [System.Windows.Forms.ProgressBarStyle]::Continuous\n$splash.Controls.Add($bar)\n\nfunction BrowseHost {\n  $bound = [string]$script:ListenHost\n  if ($bound -ne '0.0.0.0') { return $bound }\n  try {\n    foreach ($addr in [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName())) {\n      if ($addr.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork) {\n        $text = [string]$addr\n        if ($text -ne '127.0.0.1' -and $text -ne '0.0.0.0') { return $text }\n      }\n    }\n  } catch {\n    # No LAN address is available; open loopback instead of http://0.0.0.0.\n  }\n  return '127.0.0.1'\n}\n\nfunction ListenUrl {\n  return ('http://{0}:{1}' -f (BrowseHost), $script:ListenPort)\n}\n\n$menu = New-Object System.Windows.Forms.ContextMenuStrip\n$itemShow = $menu.Items.Add((T '显示主界面' 'Show main window'))\n$itemOpenUrl = $menu.Items.Add((T '打开 http://127.0.0.1:3080' 'Open http://127.0.0.1:3080'))\n$itemStart = $menu.Items.Add((T '启动服务' 'Start service'))\n$itemStop = $menu.Items.Add((T '停止服务' 'Stop service'))\n$itemRestart = $menu.Items.Add((T '重启服务' 'Restart service'))\n[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))\n$itemListen = $menu.Items.Add((T '监听地址…' 'Listen address…'))\n$itemSettings = $menu.Items.Add((T '系统设置' 'Settings'))\n[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))\n$itemExit = $menu.Items.Add((T '退出' 'Exit'))\n\nfunction SyncMenu {\n  $url = ListenUrl\n  $itemOpenUrl.Text = (T \"打开 $url\" \"Open $url\")\n  $itemOpenUrl.Enabled = [bool]$script:Running\n  $itemStart.Enabled = -not $script:Running\n  $itemStop.Enabled = [bool]$script:Running\n  $itemRestart.Enabled = [bool]$script:Running\n}\n\nfunction FocusListenForm {\n  if ($null -eq $script:ListenForm) { return }\n  $script:ListenForm.Show()\n  $script:ListenForm.WindowState = [System.Windows.Forms.FormWindowState]::Normal\n  $script:ListenForm.Activate()\n  $script:ListenForm.BringToFront()\n  [void][DshNative]::ShowWindow($script:ListenForm.Handle, [DshNative]::SW_RESTORE)\n  [void][DshNative]::ShowWindow($script:ListenForm.Handle, [DshNative]::SW_SHOW)\n  [void][DshNative]::SetForegroundWindow($script:ListenForm.Handle)\n}\n\n# Every control an event handler reads lives at script scope. A handler runs\n# long after ShowListenDialog returned, and PowerShell discards the function's\n# local scope on return: a captured local reads back as $null and the call on\n# it raises \"cannot call a method on a null-valued expression\".\nfunction ShowListenDialog {\n  if ($null -ne $script:ListenForm -and -not $script:ListenForm.IsDisposed) {\n    FocusListenForm\n    return\n  }\n\n  $script:ListenForm = New-Object System.Windows.Forms.Form\n  $script:ListenForm.Text = (T '监听地址' 'Listen address')\n  $script:ListenForm.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog\n  $script:ListenForm.MaximizeBox = $false\n  $script:ListenForm.MinimizeBox = $false\n  $script:ListenForm.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen\n  $script:ListenForm.ClientSize = New-Object System.Drawing.Size(360, 200)\n  $script:ListenForm.ShowInTaskbar = $false\n  $script:ListenForm.ShowIcon = $false\n  $script:ListenForm.TopMost = $true\n\n  $bindLabel = New-Object System.Windows.Forms.Label\n  $bindLabel.Location = New-Object System.Drawing.Point(16, 16)\n  $bindLabel.Size = New-Object System.Drawing.Size(80, 24)\n  $bindLabel.Text = (T 'IP' 'IP')\n  $script:ListenForm.Controls.Add($bindLabel)\n\n  $script:ListenBindBox = New-Object System.Windows.Forms.ComboBox\n  $script:ListenBindBox.Location = New-Object System.Drawing.Point(100, 14)\n  $script:ListenBindBox.Size = New-Object System.Drawing.Size(240, 24)\n  $script:ListenBindBox.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList\n  [void]$script:ListenBindBox.Items.Add('127.0.0.1')\n  [void]$script:ListenBindBox.Items.Add('0.0.0.0')\n  $bindIndex = $script:ListenBindBox.Items.IndexOf($script:ListenHost)\n  $script:ListenBindBox.SelectedIndex = $(if ($bindIndex -ge 0) { $bindIndex } else { 0 })\n  $script:ListenForm.Controls.Add($script:ListenBindBox)\n\n  $portLabel = New-Object System.Windows.Forms.Label\n  $portLabel.Location = New-Object System.Drawing.Point(16, 52)\n  $portLabel.Size = New-Object System.Drawing.Size(80, 24)\n  $portLabel.Text = (T '端口' 'Port')\n  $script:ListenForm.Controls.Add($portLabel)\n\n  $script:ListenPortBox = New-Object System.Windows.Forms.NumericUpDown\n  $script:ListenPortBox.Location = New-Object System.Drawing.Point(100, 50)\n  $script:ListenPortBox.Size = New-Object System.Drawing.Size(240, 24)\n  $script:ListenPortBox.Minimum = 0\n  $script:ListenPortBox.Maximum = 65535\n  $nextPort = 3080\n  if ([int]::TryParse([string]$script:ListenPort, [ref]$nextPort)) {\n    if ($nextPort -lt 0) { $nextPort = 0 }\n    if ($nextPort -gt 65535) { $nextPort = 65535 }\n    $script:ListenPortBox.Value = $nextPort\n  }\n  $script:ListenForm.Controls.Add($script:ListenPortBox)\n\n  $hint = New-Object System.Windows.Forms.Label\n  $hint.Location = New-Object System.Drawing.Point(16, 86)\n  $hint.Size = New-Object System.Drawing.Size(324, 48)\n  $hint.Text = (T '127.0.0.1 仅本机可访问。0.0.0.0 会把服务暴露到局域网。' '127.0.0.1 is this computer only. 0.0.0.0 exposes the service on the LAN.')\n  $script:ListenForm.Controls.Add($hint)\n\n  $ok = New-Object System.Windows.Forms.Button\n  $ok.Location = New-Object System.Drawing.Point(164, 148)\n  $ok.Size = New-Object System.Drawing.Size(84, 28)\n  $ok.Text = (T '确定' 'OK')\n  $script:ListenForm.AcceptButton = $ok\n  $script:ListenForm.Controls.Add($ok)\n\n  $cancel = New-Object System.Windows.Forms.Button\n  $cancel.Location = New-Object System.Drawing.Point(256, 148)\n  $cancel.Size = New-Object System.Drawing.Size(84, 28)\n  $cancel.Text = (T '取消' 'Cancel')\n  $script:ListenForm.CancelButton = $cancel\n  $script:ListenForm.Controls.Add($cancel)\n\n  $ok.add_Click({\n    try {\n      $chosenHost = [string]$script:ListenBindBox.SelectedItem\n      $chosenPort = [int]$script:ListenPortBox.Value\n      $script:ListenForm.Close()\n      if ($chosenHost -ne '') {\n        Emit @{ type = 'listen'; host = $chosenHost; port = $chosenPort }\n      }\n    } catch {\n      # A dialog fault must not reach the WinForms unhandled-exception dialog.\n    }\n  })\n  $cancel.add_Click({\n    try { $script:ListenForm.Close() } catch { }\n  })\n  $script:ListenForm.add_FormClosed({\n    $script:ListenBindBox = $null\n    $script:ListenPortBox = $null\n    $script:ListenForm = $null\n  })\n  FocusListenForm\n}\n\n$itemShow.add_Click({ Emit @{ type = 'show' } })\n$itemOpenUrl.add_Click({\n  try {\n    $url = ListenUrl\n    if ($url -match '^http://') { Start-Process $url }\n  } catch {\n    # Opening the default browser must not tear down the tray host.\n  }\n})\n$itemStart.add_Click({ Emit @{ type = 'start' } })\n$itemStop.add_Click({ Emit @{ type = 'stop' } })\n$itemRestart.add_Click({ Emit @{ type = 'restart' } })\n$itemListen.add_Click({\n  try { $menu.Close() } catch { }\n  try { ShowListenDialog } catch { }\n})\n$itemSettings.add_Click({ Emit @{ type = 'settings' } })\n$itemExit.add_Click({ Emit @{ type = 'quit' } })\nSyncMenu\n\n$notify = New-Object System.Windows.Forms.NotifyIcon\n$notify.Icon = $icon\n$notify.Text = 'DeepSeek Harness'\n$notify.ContextMenuStrip = $menu\n$notify.Visible = $true\n$notify.add_MouseUp({\n  param($sender, $e)\n  try {\n    if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {\n      Emit @{ type = 'show' }\n    }\n  } catch {\n    # NotifyIcon mouse events must not tear down the tray host.\n  }\n})\n\nfunction HandleLine([string]$line) {\n  if (-not $line) { return }\n  try { $msg = $line | ConvertFrom-Json } catch { return }\n  try {\n  switch ([string]$msg.type) {\n    'progress' {\n      $text = PickText $msg\n      if ($text) { $label.Text = $text }\n      if ($null -ne $msg.percent) {\n        $percent = 0\n        if ([int]::TryParse([string]$msg.percent, [ref]$percent)) {\n          if ($percent -lt 0) { $percent = 0 }\n          if ($percent -gt 100) { $percent = 100 }\n          $bar.Value = $percent\n        }\n      }\n      if (-not $splash.Visible) { $splash.Show() }\n    }\n    'ready' {\n      $splash.Hide()\n      $notify.Visible = $true\n    }\n    'state' {\n      $script:Running = [bool]$msg.running\n      SyncMenu\n    }\n    'listen' {\n      if ($null -ne $msg.host -and [string]$msg.host -ne '') { $script:ListenHost = [string]$msg.host }\n      $nextPort = 0\n      if ([int]::TryParse([string]$msg.port, [ref]$nextPort)) { $script:ListenPort = $nextPort }\n      SyncMenu\n    }\n    'error' {\n      $text = PickText $msg\n      if ($text) { $label.Text = $text }\n      $splash.Hide()\n      $notify.Visible = $true\n      $notify.BalloonTipTitle = 'DeepSeek Harness'\n      $notify.BalloonTipText = $text\n      $notify.ShowBalloonTip(4000)\n    }\n    'focus' {\n      $focusPid = 0\n      [void][int]::TryParse([string]$msg.pid, [ref]$focusPid)\n      FocusPid $focusPid\n    }\n    'quit' {\n      $notify.Visible = $false\n      [System.Windows.Forms.Application]::Exit()\n    }\n  }\n  } catch {\n    # A bad host message must not tear down the splash/tray process.\n  }\n}\n\n$queue = New-Object System.Collections.Concurrent.ConcurrentQueue[string]\n$pump = New-Object System.Windows.Forms.Timer\n$pump.Interval = 50\n$pump.add_Tick({\n  $line = $null\n  while ($queue.TryDequeue([ref]$line)) {\n    HandleLine $line\n  }\n})\n$pump.Start()\n\n# Node's JSON lines arrive through an async StreamReader polled on this STA\n# thread. A System.Threading.Thread running a PowerShell scriptblock has no\n# runspace attached, so the engine tears the whole process down instead of\n# raising a catchable error: no stderr, no trap, and an unexplained exit.\n$stdinReader = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), (New-Object System.Text.UTF8Encoding $false))\n$script:ReadTask = $stdinReader.ReadLineAsync()\n$reader = New-Object System.Windows.Forms.Timer\n$reader.Interval = 50\n$reader.add_Tick({\n  try {\n    while ($null -ne $script:ReadTask -and $script:ReadTask.IsCompleted) {\n      $line = $script:ReadTask.Result\n      if ($null -eq $line) {\n        $script:ReadTask = $null\n        $queue.Enqueue('{\"type\":\"quit\"}')\n        return\n      }\n      $script:ReadTask = $stdinReader.ReadLineAsync()\n      $queue.Enqueue($line)\n    }\n  } catch {\n    # A faulted or closed stdin means Node is gone; quit through the queue.\n    $script:ReadTask = $null\n    $queue.Enqueue('{\"type\":\"quit\"}')\n  }\n})\n$reader.Start()\n\n$hidden = New-Object System.Windows.Forms.Form\n$hidden.ShowInTaskbar = $false\n$hidden.Opacity = 0\n$hidden.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedToolWindow\n$hidden.Size = New-Object System.Drawing.Size(0, 0)\n$hidden.add_Shown({ $hidden.Hide() })\n$hidden.add_FormClosed({\n  $notify.Visible = $false\n  $notify.Dispose()\n})\n\n$splash.Show()\n[System.Windows.Forms.Application]::Run($hidden)\n$notify.Visible = $false\n$notify.Dispose()\n"

/**
 * Parse one tray-to-Node JSON line. Unknown JSON and unknown types are dropped.
 * @param line - one line, without the trailing newline.
 * @returns the command, or `undefined` when the line is not a tray command.
 */
export function parseShellToHost(line: string): ShellToHost | undefined {
  const trimmed = line.trim()
  if (trimmed.length === 0) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    // Non-JSON stdout from PowerShell startup noise is ignored.
    return undefined
  }
  if (parsed === null || typeof parsed !== 'object' || !('type' in parsed)) return undefined
  const type = (parsed as { type: unknown }).type
  if (typeof type !== 'string' || !SHELL_TO_HOST_TYPES.has(type)) return undefined
  if (type === 'listen') {
    const listen = parseDesktopListen(parsed)
    if (listen === undefined) return undefined
    return { type: 'listen', host: listen.host, port: listen.port }
  }
  return { type: type as Exclude<ShellToHost['type'], 'listen'> }
}

/**
 * Serialize one Node-to-tray message as a JSON line (no trailing newline).
 * @param message - the outbound command.
 * @returns compact JSON.
 */
export function formatHostToShell(message: HostToShell): string {
  return JSON.stringify(message)
}

/** The PowerShell child `startWindowsDesktopShell` talks to. */
export interface WindowsDesktopShellChild {
  /** JSON-line sink. */
  readonly stdin: { write(chunk: string, encoding?: BufferEncoding): boolean }
  /** JSON-line source. */
  readonly stdout: {
    setEncoding(encoding: BufferEncoding): void
    on(event: 'data', listener: (chunk: string) => void): void
  }
  /**
   * Register an exit listener.
   * @param event - only `exit` is used.
   * @param listener - runs after the child exits.
   */
  on(event: 'exit', listener: () => void): void
  /** Kill the child process. */
  kill(): boolean
}

/** Replaceable process and filesystem effects for {@link startWindowsDesktopShell}. */
export interface WindowsDesktopShellIo {
  /** Parent pid advertised to the tray so it exits if Node dies. */
  parentPid: number
  /** Path of the packaged exe; sibling `dsh-web.ico` is preferred for the tray. */
  execPath: string
  /**
   * Directory the .ps1 host script is written to. Production uses `$DSH_HOME`,
   * not `%TEMP%`: a temp path is shared with every other process on the host
   * and is the directory endpoint protection scans most aggressively, and a
   * script deleted or locked under a running PowerShell kills the tray.
   */
  scriptDir: string
  /** Environment used to locate powershell.exe and to populate the child. */
  env?: NodeJS.ProcessEnv
  /**
   * Spawn PowerShell. Production uses child_process.spawn.
   * @param command - powershell.exe path.
   * @param args - already assembled arguments including -File.
   * @param env - environment including DSH_WEB_PARENT_PID, DSH_WEB_EXE, and DSH_WEB_ICON.
   * @returns the child with piped stdio.
   */
  spawn(
    command: string,
    args: readonly string[],
    env: NodeJS.ProcessEnv,
  ): WindowsDesktopShellChild
  /**
   * Write the embedded script.
   * @param file - destination path.
   * @param contents - UTF-8 text; the implementation prepends a BOM.
   */
  writeFile(file: string, contents: string): void
  /**
   * Remove the temporary script.
   * @param file - path previously passed to writeFile.
   */
  unlink(file: string): void
}

/** A live tray host the desktop state machine can talk to. */
export interface WindowsDesktopShell {
  /**
   * Send one command to the tray.
   * @param message - outbound command.
   */
  send(message: HostToShell): void
  /**
   * Subscribe to tray commands. Replaces the previous handler.
   * @param handler - receives parsed commands; unknown lines are dropped.
   */
  onCommand(handler: (command: ShellToHost) => void): void
  /**
   * Subscribe to unexpected tray-process exit. Replaces the previous handler.
   * `close()` does not invoke this handler.
   * @param handler - runs after the child exits on its own.
   */
  onExit(handler: () => void): void
  /** Kill the tray process and delete the temporary script. */
  close(): void
}

/**
 * Resolve Windows PowerShell 5.1. pwsh on PATH is not used: WinForms STA
 * hosting is the Windows PowerShell contract.
 * @param env - process environment.
 * @returns an absolute powershell.exe path.
 */
export function windowsPowerShellPath(env: NodeJS.ProcessEnv = process.env): string {
  const root = env.SystemRoot && env.SystemRoot.length > 0 ? env.SystemRoot : 'C:\\Windows'
  return join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

/**
 * Default I/O for production: real spawn, temp dir, and UTF-8 BOM writes.
 * @param execPath - packaged executable path.
 * @returns the production I/O bag.
 */
export function defaultWindowsDesktopShellIo(execPath: string, scriptDir: string): WindowsDesktopShellIo {
  return {
    parentPid: process.pid,
    execPath,
    scriptDir,
    spawn: (command, args, env) => spawn(command, [...args], {
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
      env,
    }),
    writeFile: (file, contents) => {
      writeFileSync(file, '\uFEFF' + contents, 'utf8')
    },
    unlink: (file) => {
      try {
        unlinkSync(file)
      } catch {
        // Host script is best-effort cleanup after an unexpected tray exit.
      }
    },
  }
}

/**
 * Start the splash/tray host and return a JSON-line session.
 * @param io - replaceable I/O; production uses {@link defaultWindowsDesktopShellIo}.
 * @returns the live session. Callers must close() it.
 */
export function startWindowsDesktopShell(io: WindowsDesktopShellIo): WindowsDesktopShell {
  const env = io.env ?? process.env
  const scriptPath = join(io.scriptDir, 'desktop-shell-' + String(io.parentPid) + '-' + String(Date.now()) + '.ps1')
  io.writeFile(scriptPath, WINDOWS_DESKTOP_SHELL_SCRIPT)
  const iconPath = resolveDesktopIconPath(io.execPath)
  const child = io.spawn(
    windowsPowerShellPath(env),
    ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptPath],
    {
      ...env,
      DSH_WEB_PARENT_PID: String(io.parentPid),
      DSH_WEB_EXE: io.execPath,
      ...(iconPath === undefined ? {} : { DSH_WEB_ICON: iconPath }),
    },
  )
  let commandHandler: ((command: ShellToHost) => void) | undefined
  let exitHandler: (() => void) | undefined
  let closed = false
  let buffer = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk
    let index = buffer.indexOf('\n')
    while (index >= 0) {
      const line = buffer.slice(0, index)
      buffer = buffer.slice(index + 1)
      const command = parseShellToHost(line)
      if (command !== undefined) commandHandler?.(command)
      index = buffer.indexOf('\n')
    }
  })
  child.on('exit', () => {
    io.unlink(scriptPath)
    if (!closed) exitHandler?.()
  })
  return {
    send(message) {
      child.stdin.write(formatHostToShell(message) + '\n', 'utf8')
    },
    onCommand(next) {
      commandHandler = next
    },
    onExit(next) {
      exitHandler = next
    },
    close() {
      if (closed) return
      closed = true
      try {
        child.stdin.write(formatHostToShell({ type: 'quit' }) + '\n', 'utf8')
      } catch {
        // stdin may already be closed if the tray exited first.
      }
      child.kill()
      io.unlink(scriptPath)
    },
  }
}
