/** Detached apply helper that replaces the product folder after this process exits. */

/** Arguments the helper script reads from argv. */
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

/**
 * PowerShell 5.1 helper that waits for `parentPid` to exit, copies the extract
 * tree over the product directory while skipping `.config`, then relaunches.
 * @param args - wait, copy, and relaunch arguments interpolated as literals.
 * @returns the script body.
 */
export function applyHelperScript(args: ApplyHelperArgs): string {
  return [
    '$ErrorActionPreference = \'Stop\'',
    `$parentPid = ${String(args.parentPid)}`,
    `$extractDir = ${powershellLiteral(args.extractDir)}`,
    `$productDir = ${powershellLiteral(args.productDir)}`,
    `$exePath = ${powershellLiteral(args.exePath)}`,
    '$deadline = (Get-Date).AddMinutes(5)',
    'while ((Get-Date) -lt $deadline) {',
    '  if ($null -eq (Get-Process -Id $parentPid -ErrorAction SilentlyContinue)) { break }',
    '  Start-Sleep -Seconds 1',
    '}',
    'if ($null -ne (Get-Process -Id $parentPid -ErrorAction SilentlyContinue)) {',
    '  throw "dsh-desktop-update: parent pid $parentPid did not exit"',
    '}',
    'robocopy $extractDir $productDir /E /XD .config /R:8 /W:2 /NFL /NDL /NJH /NJS /NP | Out-Null',
    'if ($LASTEXITCODE -ge 8) { throw "dsh-desktop-update: robocopy failed with $LASTEXITCODE" }',
    'Start-Process -FilePath $exePath -WorkingDirectory $productDir',
    '',
  ].join('\n')
}

/**
 * Quote a filesystem path as a PowerShell single-quoted literal.
 * @param value - absolute path.
 * @returns a PowerShell string literal.
 */
export function powershellLiteral(value: string): string {
  return `'${value.replaceAll('\'', '\'\'')}'`
}
