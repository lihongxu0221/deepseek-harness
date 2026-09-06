/** Apply helper: survive Host exit, show replace progress, copy, then relaunch. */

import { join } from 'node:path'

/** Arguments the helper script reads from interpolated literals. */
export interface ApplyHelperArgs {
  /** PID of the running packaged desktop (this process). */
  readonly parentPid: number
  /** Extracted zip root that already passed launcher/VERSION checks. */
  readonly extractDir: string
  /** Installed product directory (the launcher's directory). */
  readonly productDir: string
  /** Absolute path of the launcher to start after the copy. */
  readonly exePath: string
}

/** `wscript.exe` launch used by production `spawnHelper`. */
export interface ApplyHelperLaunchSpec {
  /** Always `wscript.exe`. */
  readonly command: string
  /** `//nologo` plus the `.vbs` path. */
  readonly args: readonly string[]
  /** Detached, ignored stdio, hidden window. */
  readonly options: {
    readonly detached: true
    readonly stdio: 'ignore'
    readonly windowsHide: true
  }
}

/**
 * Resolve Windows PowerShell 5.1. PATH `powershell.exe` may be missing or pwsh.
 * @param env - process environment.
 * @returns an absolute powershell.exe path.
 */
export function windowsPowerShell51Path(env: NodeJS.ProcessEnv = process.env): string {
  const root = env.SystemRoot && env.SystemRoot.length > 0 ? env.SystemRoot : 'C:\\Windows'
  return join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

/**
 * Quote a filesystem path as one token inside a `WScript.Shell.Run` command.
 * @param value - absolute path.
 * @returns a double-quoted token.
 */
export function wshCommandToken(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

/**
 * VBScript that `WScript.Shell.Run`s the apply `.ps1` hidden and without waiting.
 * `wscript.exe` is a GUI host, so this both starts `-File` and outlives Node.
 * @param scriptPath - absolute path of the helper `.ps1`.
 * @param powershellPath - absolute Windows PowerShell 5.1 path.
 * @returns the `.vbs` body (UTF-16 LE BOM is added at write time).
 */
export function applyHelperVbs(scriptPath: string, powershellPath: string): string {
  const command = [
    wshCommandToken(powershellPath),
    '-NoProfile',
    '-STA',
    '-WindowStyle',
    'Hidden',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    wshCommandToken(scriptPath),
  ].join(' ')
  return [
    'Set sh = CreateObject("WScript.Shell")',
    `sh.Run "${command.replaceAll('"', '""')}", 0, False`,
    '',
  ].join('\r\n')
}

/**
 * Build the `wscript.exe` spawn used to run {@link applyHelperVbs} after this
 * process exits.
 * @param vbsPath - absolute path of the helper `.vbs`.
 * @returns spawn file, argv, and options.
 */
export function applyHelperLaunchSpec(vbsPath: string): ApplyHelperLaunchSpec {
  return {
    command: 'wscript.exe',
    args: ['//nologo', vbsPath],
    options: { detached: true, stdio: 'ignore', windowsHide: true },
  }
}

/**
 * PowerShell 5.1 helper that waits for `parentPid` to exit, copies the extract
 * tree over the product directory while skipping `.config`, then relaunches.
 * The script starts with a UTF-8 BOM so Windows PowerShell 5.1 reads the
 * Chinese splash strings. Every step appends to `apply.log` beside this
 * script. A WinForms splash reports replace progress after the Host UI is
 * gone; a failure also raises a MessageBox.
 * @param args - wait, copy, and relaunch arguments interpolated as literals.
 * @returns the script body, including a leading UTF-8 BOM.
 */
export function applyHelperScript(args: ApplyHelperArgs): string {
  const body = [
    '$ErrorActionPreference = \'Stop\'',
    '$log = Join-Path $PSScriptRoot \'apply.log\'',
    'function Write-ApplyLog([string]$message) {',
    '  Add-Content -Path $log -Value "$(Get-Date -Format o) $message"',
    '}',
    `$parentPid = ${String(args.parentPid)}`,
    `$extractDir = ${powershellLiteral(args.extractDir)}`,
    `$productDir = ${powershellLiteral(args.productDir)}`,
    `$exePath = ${powershellLiteral(args.exePath)}`,
    '$script:HasUi = $false',
    '$script:Form = $null',
    '$script:Label = $null',
    '$script:Bar = $null',
    '$script:IsZh = $false',
    'try {',
    '  Add-Type -AssemblyName System.Windows.Forms',
    '  Add-Type -AssemblyName System.Drawing',
    '  [System.Windows.Forms.Application]::EnableVisualStyles()',
    '  $script:IsZh = [System.Globalization.CultureInfo]::CurrentUICulture.TwoLetterISOLanguageName -eq \'zh\'',
    '  $script:Form = New-Object System.Windows.Forms.Form',
    '  $script:Form.Text = \'DeepSeek Harness\'',
    '  $script:Form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog',
    '  $script:Form.MaximizeBox = $false',
    '  $script:Form.MinimizeBox = $false',
    '  $script:Form.ControlBox = $false',
    '  $script:Form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen',
    '  $script:Form.ClientSize = New-Object System.Drawing.Size(460, 150)',
    '  $script:Form.TopMost = $true',
    '  $script:Form.ShowInTaskbar = $true',
    '  $script:Form.BackColor = [System.Drawing.Color]::White',
    '  $iconPath = Join-Path (Split-Path $exePath -Parent) \'dsh-web.ico\'',
    '  if (Test-Path -LiteralPath $iconPath) {',
    '    $script:Form.Icon = New-Object System.Drawing.Icon $iconPath',
    '  }',
    '  $title = New-Object System.Windows.Forms.Label',
    '  $title.Location = New-Object System.Drawing.Point(20, 16)',
    '  $title.Size = New-Object System.Drawing.Size(420, 28)',
    '  $title.Font = New-Object System.Drawing.Font(\'Segoe UI\', 12, [System.Drawing.FontStyle]::Bold)',
    '  $title.Text = \'DeepSeek Harness\'',
    '  $script:Form.Controls.Add($title)',
    '  $script:Label = New-Object System.Windows.Forms.Label',
    '  $script:Label.Location = New-Object System.Drawing.Point(20, 48)',
    '  $script:Label.Size = New-Object System.Drawing.Size(420, 36)',
    '  $script:Label.Font = New-Object System.Drawing.Font(\'Segoe UI\', 10)',
    '  $script:Form.Controls.Add($script:Label)',
    '  $script:Bar = New-Object System.Windows.Forms.ProgressBar',
    '  $script:Bar.Location = New-Object System.Drawing.Point(20, 100)',
    '  $script:Bar.Size = New-Object System.Drawing.Size(420, 22)',
    '  $script:Bar.Minimum = 0',
    '  $script:Bar.Maximum = 100',
    '  $script:Bar.Value = 8',
    '  $script:Bar.Style = [System.Windows.Forms.ProgressBarStyle]::Continuous',
    '  $script:Form.Controls.Add($script:Bar)',
    '  $script:HasUi = $true',
    '} catch {',
    '  Write-ApplyLog "WinForms splash unavailable: $_"',
    '  $script:HasUi = $false',
    '}',
    'function Set-ApplyProgress([int]$percent, [string]$zh, [string]$en) {',
    '  Write-ApplyLog $en',
    '  if (-not $script:HasUi) { return }',
    '  $script:Label.Text = $(if ($script:IsZh) { $zh } else { $en })',
    '  if ($percent -lt 0) { $percent = 0 }',
    '  if ($percent -gt 100) { $percent = 100 }',
    '  $script:Bar.Value = $percent',
    '  $script:Form.Refresh()',
    '  [System.Windows.Forms.Application]::DoEvents()',
    '}',
    'function Test-FileUnlocked([string]$path) {',
    '  if (-not (Test-Path -LiteralPath $path)) { return $true }',
    '  try {',
    '    $stream = [System.IO.File]::Open($path, \'Open\', \'ReadWrite\', \'None\')',
    '    $stream.Close()',
    '    return $true',
    '  } catch {',
    '    return $false',
    '  }',
    '}',
    'function Wait-ApplyDeadline([scriptblock]$done) {',
    '  $deadline = (Get-Date).AddMinutes(5)',
    '  while ((Get-Date) -lt $deadline) {',
    '    if (& $done) { return $true }',
    '    if ($script:HasUi) { [System.Windows.Forms.Application]::DoEvents() }',
    '    Start-Sleep -Milliseconds 200',
    '  }',
    '  return $false',
    '}',
    'try {',
    '  if ($script:HasUi) {',
    '    $script:Form.Show()',
    '    $script:Form.Refresh()',
    '    [System.Windows.Forms.Application]::DoEvents()',
    '  }',
    '  Set-ApplyProgress 10 \'正在退出当前进程…\' \'Waiting for the current process to exit…\'',
    '  if (-not (Wait-ApplyDeadline { $null -eq (Get-Process -Id $parentPid -ErrorAction SilentlyContinue) })) {',
    '    throw "dsh-desktop-update: parent pid $parentPid did not exit"',
    '  }',
    '  Set-ApplyProgress 25 \'正在等待程序文件解锁…\' \'Waiting for program files to unlock…\'',
    '  if (-not (Wait-ApplyDeadline { Test-FileUnlocked $exePath })) {',
    '    throw "dsh-desktop-update: $exePath stayed locked"',
    '  }',
    '  Set-ApplyProgress 40 \'正在替换程序文件…\' \'Replacing program files…\'',
    '  & robocopy.exe $extractDir $productDir /E /XD .config /R:8 /W:2 /NFL /NDL /NJH /NJS /NP',
    '  $copyCode = $LASTEXITCODE',
    '  Write-ApplyLog "robocopy exit $copyCode"',
    '  if ($copyCode -ge 8) { throw "dsh-desktop-update: robocopy failed with $copyCode" }',
    '  Set-ApplyProgress 90 \'正在重新启动…\' \'Restarting…\'',
    '  Start-Process -FilePath $exePath -WorkingDirectory $productDir',
    '  Set-ApplyProgress 100 \'更新完成\' \'Update complete\'',
    '  Write-ApplyLog \'apply complete\'',
    '  if ($script:HasUi) { Start-Sleep -Milliseconds 400 }',
    '} catch {',
    '  Write-ApplyLog "$_"',
    '  if ($script:HasUi) {',
    '    $text = [string]$_',
    '    [void][System.Windows.Forms.MessageBox]::Show(',
    '      $text,',
    '      \'DeepSeek Harness\',',
    '      [System.Windows.Forms.MessageBoxButtons]::OK,',
    '      [System.Windows.Forms.MessageBoxIcon]::Error',
    '    )',
    '  }',
    '  throw',
    '} finally {',
    '  if ($script:HasUi -and $null -ne $script:Form) { $script:Form.Close() }',
    '}',
    '',
  ].join('\n')
  return `\uFEFF${body}`
}

/**
 * Quote a filesystem path as a PowerShell single-quoted literal.
 * @param value - absolute path.
 * @returns a PowerShell string literal.
 */
export function powershellLiteral(value: string): string {
  return `'${value.replaceAll('\'', '\'\'')}'`
}
