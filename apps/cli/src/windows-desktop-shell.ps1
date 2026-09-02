# DeepSeek Harness packaged Web desktop splash + tray host.
# Node speaks JSON lines on stdin; this process replies with JSON lines on stdout.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
# A fault inside a WinForms event handler otherwise raises the "unhandled
# exception" dialog whose Quit button kills the tray. Route those faults to the
# balloon instead so the tray survives a bad click.
[System.Windows.Forms.Application]::SetUnhandledExceptionMode([System.Windows.Forms.UnhandledExceptionMode]::CatchException)
[System.Windows.Forms.Application]::add_ThreadException({
  param($sender, $e)
  try {
    if ($null -ne $script:Notify) {
      $script:Notify.BalloonTipTitle = 'DeepSeek Harness'
      $script:Notify.BalloonTipText = $e.Exception.Message
      $script:Notify.ShowBalloonTip(4000)
    }
  } catch { }
})

$script:IsZh = [System.Globalization.CultureInfo]::CurrentUICulture.TwoLetterISOLanguageName -eq 'zh'
function T($zh, $en) {
  if ($script:IsZh) { return $zh }
  return $en
}

function PickText($msg) {
  if ($script:IsZh -and $null -ne $msg.zh -and [string]$msg.zh -ne '') {
    return [string]$msg.zh
  }
  if ($null -ne $msg.text) { return [string]$msg.text }
  return ''
}

$script:Running = $false
$script:ListenHost = '127.0.0.1'
$script:ListenPort = 3080
$script:ListenUrlOverride = ''
$script:ListenForm = $null
$script:ListenBindBox = $null
$script:ListenPortBox = $null

try {
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class DshNative {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  public const int SW_RESTORE = 9;
  public const int SW_SHOW = 5;
}
"@
} catch {
  if ($_.Exception.Message -notmatch 'DshNative') { throw }
}

function Emit($obj) {
  $json = ($obj | ConvertTo-Json -Compress)
  [Console]::Out.WriteLine($json)
  [Console]::Out.Flush()
}

function FocusHwnd([IntPtr]$hWnd) {
  if ([DshNative]::IsIconic($hWnd)) {
    [void][DshNative]::ShowWindow($hWnd, [DshNative]::SW_RESTORE)
  }
  [void][DshNative]::ShowWindow($hWnd, [DshNative]::SW_SHOW)
  [void][DshNative]::SetForegroundWindow($hWnd)
}

# Raise a visible product window. Pid match covers a live --app process; title
# match covers a handoff where the HWND lives on a different Chromium pid.
function FocusAppWindow([int]$ProcessId) {
  $script:Target = [IntPtr]::Zero
  $script:TitleTarget = [IntPtr]::Zero
  $cb = [DshNative+EnumWindowsProc] {
    param([IntPtr]$hWnd, [IntPtr]$lParam)
    if (-not [DshNative]::IsWindowVisible($hWnd)) { return $true }
    $wndPid = 0
    [void][DshNative]::GetWindowThreadProcessId($hWnd, [ref]$wndPid)
    if ($ProcessId -gt 0 -and $wndPid -eq $ProcessId) {
      $script:Target = $hWnd
      return $false
    }
    $len = [DshNative]::GetWindowTextLength($hWnd)
    if ($len -gt 0) {
      $sb = New-Object System.Text.StringBuilder ($len + 1)
      [void][DshNative]::GetWindowText($hWnd, $sb, $sb.Capacity)
      $title = $sb.ToString()
      if ($title -eq 'DeepSeek Harness' -or $title.EndsWith(' — DeepSeek Harness')) {
        $script:TitleTarget = $hWnd
      }
    }
    return $true
  }
  [void][DshNative]::EnumWindows($cb, [IntPtr]::Zero)
  if ($script:Target -ne [IntPtr]::Zero) {
    FocusHwnd $script:Target
    return $true
  }
  if ($script:TitleTarget -ne [IntPtr]::Zero) {
    FocusHwnd $script:TitleTarget
    return $true
  }
  return $false
}

function IconCandidates([string]$filename, [string]$explicit) {
  $candidates = @()
  if ($explicit) { $candidates += $explicit }
  if ($env:DSH_WEB_EXE) {
    $exeDir = [System.IO.Path]::GetDirectoryName([string]$env:DSH_WEB_EXE)
    if ($exeDir) { $candidates += (Join-Path $exeDir $filename) }
  }
  return $candidates
}

function LoadDesktopIcon([string]$filename, [string]$explicit) {
  $small = [System.Windows.Forms.SystemInformation]::SmallIconSize
  foreach ($path in (IconCandidates $filename $explicit)) {
    if (-not $path -or -not (Test-Path -LiteralPath $path)) { continue }
    try {
      return New-Object System.Drawing.Icon($path, $small.Width, $small.Height)
    } catch {
      # Unreadable ico files fall through to the next candidate.
    }
  }
  return $null
}

$script:IconStopped = LoadDesktopIcon 'dsh-web.ico' ([string]$env:DSH_WEB_ICON)
$script:IconRunning = LoadDesktopIcon 'dsh-web-running.ico' ([string]$env:DSH_WEB_ICON_RUNNING)
if ($null -eq $script:IconStopped) {
  try {
    if ($env:DSH_WEB_EXE) {
      $script:IconStopped = [System.Drawing.Icon]::ExtractAssociatedIcon($env:DSH_WEB_EXE)
    }
  } catch {
    # ExtractAssociatedIcon fails on some paths; keep SystemIcons.Application.
  }
}
if ($null -eq $script:IconStopped) {
  $script:IconStopped = [System.Drawing.SystemIcons]::Application
}
if ($null -eq $script:IconRunning) { $script:IconRunning = $script:IconStopped }
$icon = $script:IconStopped

$splash = New-Object System.Windows.Forms.Form
$splash.Text = 'DeepSeek Harness'
$splash.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
$splash.MaximizeBox = $false
$splash.MinimizeBox = $false
$splash.ControlBox = $false
$splash.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$splash.ClientSize = New-Object System.Drawing.Size(460, 150)
$splash.TopMost = $true
$splash.ShowInTaskbar = $false
$splash.Icon = $icon
$splash.BackColor = [System.Drawing.Color]::White

$title = New-Object System.Windows.Forms.Label
$title.Location = New-Object System.Drawing.Point(20, 16)
$title.Size = New-Object System.Drawing.Size(420, 28)
$title.Font = New-Object System.Drawing.Font('Segoe UI', 12, [System.Drawing.FontStyle]::Bold)
$title.Text = 'DeepSeek Harness'
$splash.Controls.Add($title)

$label = New-Object System.Windows.Forms.Label
$label.Location = New-Object System.Drawing.Point(20, 48)
$label.Size = New-Object System.Drawing.Size(420, 36)
$label.Font = New-Object System.Drawing.Font('Segoe UI', 10)
$label.Text = (T '正在启动…' 'Starting…')
$splash.Controls.Add($label)

$bar = New-Object System.Windows.Forms.ProgressBar
$bar.Location = New-Object System.Drawing.Point(20, 100)
$bar.Size = New-Object System.Drawing.Size(420, 22)
$bar.Minimum = 0
$bar.Maximum = 100
$bar.Value = 8
$bar.Style = [System.Windows.Forms.ProgressBarStyle]::Continuous
$splash.Controls.Add($bar)

function BrowseHost {
  $bound = [string]$script:ListenHost
  if ($bound -ne '0.0.0.0') { return $bound }
  try {
    foreach ($addr in [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName())) {
      if ($addr.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork) {
        $text = [string]$addr
        if ($text -ne '127.0.0.1' -and $text -ne '0.0.0.0') { return $text }
      }
    }
  } catch {
    # No LAN address is available; open loopback instead of http://0.0.0.0.
  }
  return '127.0.0.1'
}

function ListenUrl {
  if ($script:ListenUrlOverride) { return [string]$script:ListenUrlOverride }
  return ('http://{0}:{1}' -f (BrowseHost), $script:ListenPort)
}

# Menu caption only. Start-Process still uses ListenUrl so the first GET
# carries the process token; the query must not appear in the tray text.
function DisplayListenUrl {
  $raw = ListenUrl
  try {
    $uri = [Uri]$raw
    if (-not $uri.IsAbsoluteUri -or $uri.Scheme -ne 'http') {
      return ('http://{0}:{1}' -f (BrowseHost), $script:ListenPort)
    }
    return $uri.GetLeftPart([UriPartial]::Authority)
  } catch {
    return ('http://{0}:{1}' -f (BrowseHost), $script:ListenPort)
  }
}

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$itemShow = $menu.Items.Add((T '显示主界面' 'Show main window'))
$itemOpenUrl = $menu.Items.Add((T '打开 http://127.0.0.1:3080' 'Open http://127.0.0.1:3080'))
$itemStart = $menu.Items.Add((T '启动服务' 'Start service'))
$itemStop = $menu.Items.Add((T '停止服务' 'Stop service'))
$itemRestart = $menu.Items.Add((T '重启服务' 'Restart service'))
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$itemListen = $menu.Items.Add((T '监听地址…' 'Listen address…'))
$itemSettings = $menu.Items.Add((T '系统设置' 'Settings'))
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$itemExit = $menu.Items.Add((T '退出' 'Exit'))

function SyncMenu {
  $url = DisplayListenUrl
  $itemOpenUrl.Text = (T "打开 $url" "Open $url")
  $itemOpenUrl.Enabled = [bool]$script:Running
  $itemStart.Enabled = -not $script:Running
  $itemStop.Enabled = [bool]$script:Running
  $itemRestart.Enabled = [bool]$script:Running
  if ($null -ne $script:Notify) {
    $script:Notify.Icon = $(if ($script:Running) { $script:IconRunning } else { $script:IconStopped })
  }
}

function FocusListenForm {
  if ($null -eq $script:ListenForm) { return }
  $script:ListenForm.Show()
  $script:ListenForm.WindowState = [System.Windows.Forms.FormWindowState]::Normal
  $script:ListenForm.Activate()
  $script:ListenForm.BringToFront()
  [void][DshNative]::ShowWindow($script:ListenForm.Handle, [DshNative]::SW_RESTORE)
  [void][DshNative]::ShowWindow($script:ListenForm.Handle, [DshNative]::SW_SHOW)
  [void][DshNative]::SetForegroundWindow($script:ListenForm.Handle)
}

# Every control an event handler reads lives at script scope. A handler runs
# long after ShowListenDialog returned, and PowerShell discards the function's
# local scope on return: a captured local reads back as $null and the call on
# it raises "cannot call a method on a null-valued expression".
function ShowListenDialog {
  if ($null -ne $script:ListenForm -and -not $script:ListenForm.IsDisposed) {
    FocusListenForm
    return
  }

  $script:ListenForm = New-Object System.Windows.Forms.Form
  $script:ListenForm.Text = (T '监听地址' 'Listen address')
  $script:ListenForm.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
  $script:ListenForm.MaximizeBox = $false
  $script:ListenForm.MinimizeBox = $false
  $script:ListenForm.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
  $script:ListenForm.ClientSize = New-Object System.Drawing.Size(360, 200)
  $script:ListenForm.ShowInTaskbar = $false
  $script:ListenForm.ShowIcon = $false
  $script:ListenForm.TopMost = $true

  $bindLabel = New-Object System.Windows.Forms.Label
  $bindLabel.Location = New-Object System.Drawing.Point(16, 16)
  $bindLabel.Size = New-Object System.Drawing.Size(80, 24)
  $bindLabel.Text = (T 'IP' 'IP')
  $script:ListenForm.Controls.Add($bindLabel)

  $script:ListenBindBox = New-Object System.Windows.Forms.ComboBox
  $script:ListenBindBox.Location = New-Object System.Drawing.Point(100, 14)
  $script:ListenBindBox.Size = New-Object System.Drawing.Size(240, 24)
  $script:ListenBindBox.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
  [void]$script:ListenBindBox.Items.Add('127.0.0.1')
  [void]$script:ListenBindBox.Items.Add('0.0.0.0')
  $bindIndex = $script:ListenBindBox.Items.IndexOf($script:ListenHost)
  $script:ListenBindBox.SelectedIndex = $(if ($bindIndex -ge 0) { $bindIndex } else { 0 })
  $script:ListenForm.Controls.Add($script:ListenBindBox)

  $portLabel = New-Object System.Windows.Forms.Label
  $portLabel.Location = New-Object System.Drawing.Point(16, 52)
  $portLabel.Size = New-Object System.Drawing.Size(80, 24)
  $portLabel.Text = (T '端口' 'Port')
  $script:ListenForm.Controls.Add($portLabel)

  $script:ListenPortBox = New-Object System.Windows.Forms.NumericUpDown
  $script:ListenPortBox.Location = New-Object System.Drawing.Point(100, 50)
  $script:ListenPortBox.Size = New-Object System.Drawing.Size(240, 24)
  $script:ListenPortBox.Minimum = 0
  $script:ListenPortBox.Maximum = 65535
  $nextPort = 3080
  if ([int]::TryParse([string]$script:ListenPort, [ref]$nextPort)) {
    if ($nextPort -lt 0) { $nextPort = 0 }
    if ($nextPort -gt 65535) { $nextPort = 65535 }
    $script:ListenPortBox.Value = $nextPort
  }
  $script:ListenForm.Controls.Add($script:ListenPortBox)

  $hint = New-Object System.Windows.Forms.Label
  $hint.Location = New-Object System.Drawing.Point(16, 86)
  $hint.Size = New-Object System.Drawing.Size(324, 48)
  $hint.Text = (T '127.0.0.1 仅本机可访问。0.0.0.0 会把服务暴露到局域网。' '127.0.0.1 is this computer only. 0.0.0.0 exposes the service on the LAN.')
  $script:ListenForm.Controls.Add($hint)

  $ok = New-Object System.Windows.Forms.Button
  $ok.Location = New-Object System.Drawing.Point(164, 148)
  $ok.Size = New-Object System.Drawing.Size(84, 28)
  $ok.Text = (T '确定' 'OK')
  $script:ListenForm.AcceptButton = $ok
  $script:ListenForm.Controls.Add($ok)

  $cancel = New-Object System.Windows.Forms.Button
  $cancel.Location = New-Object System.Drawing.Point(256, 148)
  $cancel.Size = New-Object System.Drawing.Size(84, 28)
  $cancel.Text = (T '取消' 'Cancel')
  $script:ListenForm.CancelButton = $cancel
  $script:ListenForm.Controls.Add($cancel)

  $ok.add_Click({
    try {
      $chosenHost = [string]$script:ListenBindBox.SelectedItem
      $chosenPort = [int]$script:ListenPortBox.Value
      $script:ListenForm.Close()
      if ($chosenHost -ne '') {
        Emit @{ type = 'listen'; host = $chosenHost; port = $chosenPort }
      }
    } catch {
      # A dialog fault must not reach the WinForms unhandled-exception dialog.
    }
  })
  $cancel.add_Click({
    try { $script:ListenForm.Close() } catch { }
  })
  $script:ListenForm.add_FormClosed({
    $script:ListenBindBox = $null
    $script:ListenPortBox = $null
    $script:ListenForm = $null
  })
  FocusListenForm
}

$itemShow.add_Click({ Emit @{ type = 'show' } })
$itemOpenUrl.add_Click({
  try {
    $url = ListenUrl
    if ($url -match '^http://') { Start-Process $url }
  } catch {
    # Opening the default browser must not tear down the tray host.
  }
})
$itemStart.add_Click({ Emit @{ type = 'start' } })
$itemStop.add_Click({ Emit @{ type = 'stop' } })
$itemRestart.add_Click({ Emit @{ type = 'restart' } })
$itemListen.add_Click({
  try { $menu.Close() } catch { }
  try { ShowListenDialog } catch { }
})
$itemSettings.add_Click({ Emit @{ type = 'settings' } })
$itemExit.add_Click({ Emit @{ type = 'quit' } })
SyncMenu

$script:Notify = New-Object System.Windows.Forms.NotifyIcon
$script:Notify.Icon = $script:IconStopped
$script:Notify.Text = 'DeepSeek Harness'
$script:Notify.ContextMenuStrip = $menu
$script:Notify.Visible = $true
$script:Notify.add_MouseUp({
  param($sender, $e)
  try {
    if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
      Emit @{ type = 'show' }
    }
  } catch {
    # NotifyIcon mouse events must not tear down the tray host.
  }
})

function HandleLine([string]$line) {
  if (-not $line) { return }
  try { $msg = $line | ConvertFrom-Json } catch { return }
  try {
  switch ([string]$msg.type) {
    'progress' {
      $text = PickText $msg
      if ($text) { $label.Text = $text }
      if ($null -ne $msg.percent) {
        $percent = 0
        if ([int]::TryParse([string]$msg.percent, [ref]$percent)) {
          if ($percent -lt 0) { $percent = 0 }
          if ($percent -gt 100) { $percent = 100 }
          $bar.Value = $percent
        }
      }
      if (-not $splash.Visible) { $splash.Show() }
    }
    'ready' {
      $splash.Hide()
      $script:Notify.Visible = $true
    }
    'state' {
      $script:Running = [bool]$msg.running
      SyncMenu
    }
    'listen' {
      if ($null -ne $msg.host -and [string]$msg.host -ne '') { $script:ListenHost = [string]$msg.host }
      $nextPort = 0
      if ([int]::TryParse([string]$msg.port, [ref]$nextPort)) { $script:ListenPort = $nextPort }
      if ($null -ne $msg.url -and [string]$msg.url -ne '') { $script:ListenUrlOverride = [string]$msg.url }
      else { $script:ListenUrlOverride = '' }
      SyncMenu
    }
    'error' {
      $text = PickText $msg
      if ($text) { $label.Text = $text }
      $splash.Hide()
      $script:Notify.Visible = $true
      $script:Notify.BalloonTipTitle = 'DeepSeek Harness'
      $script:Notify.BalloonTipText = $text
      $script:Notify.ShowBalloonTip(4000)
    }
    'focus' {
      $focusPid = 0
      [void][int]::TryParse([string]$msg.pid, [ref]$focusPid)
      if (-not (FocusAppWindow $focusPid)) {
        Emit @{ type = 'window-missing' }
      }
    }
    'quit' {
      $script:Notify.Visible = $false
      [System.Windows.Forms.Application]::Exit()
    }
  }
  } catch {
    # A bad host message must not tear down the splash/tray process.
  }
}

$queue = New-Object System.Collections.Concurrent.ConcurrentQueue[string]
$pump = New-Object System.Windows.Forms.Timer
$pump.Interval = 50
$pump.add_Tick({
  $line = $null
  while ($queue.TryDequeue([ref]$line)) {
    HandleLine $line
  }
})
$pump.Start()

# Node's JSON lines arrive through an async StreamReader polled on this STA
# thread. A System.Threading.Thread running a PowerShell scriptblock has no
# runspace attached, so the engine tears the whole process down instead of
# raising a catchable error: no stderr, no trap, and an unexplained exit.
$stdinReader = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), (New-Object System.Text.UTF8Encoding $false))
$script:ReadTask = $stdinReader.ReadLineAsync()
$reader = New-Object System.Windows.Forms.Timer
$reader.Interval = 50
$reader.add_Tick({
  try {
    while ($null -ne $script:ReadTask -and $script:ReadTask.IsCompleted) {
      $line = $script:ReadTask.Result
      if ($null -eq $line) {
        $script:ReadTask = $null
        $queue.Enqueue('{"type":"quit"}')
        return
      }
      $script:ReadTask = $stdinReader.ReadLineAsync()
      $queue.Enqueue($line)
    }
  } catch {
    # A faulted or closed stdin means Node is gone; quit through the queue.
    $script:ReadTask = $null
    $queue.Enqueue('{"type":"quit"}')
  }
})
$reader.Start()

$hidden = New-Object System.Windows.Forms.Form
$hidden.ShowInTaskbar = $false
$hidden.Opacity = 0
$hidden.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedToolWindow
$hidden.Size = New-Object System.Drawing.Size(0, 0)
$hidden.add_Shown({ $hidden.Hide() })
$hidden.add_FormClosed({
  $script:Notify.Visible = $false
  $script:Notify.Dispose()
})

$splash.Show()
[System.Windows.Forms.Application]::Run($hidden)
$script:Notify.Visible = $false
$script:Notify.Dispose()
