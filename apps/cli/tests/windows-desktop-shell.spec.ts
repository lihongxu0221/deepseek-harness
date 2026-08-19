import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  formatHostToShell,
  parseShellToHost,
  resolveDesktopIconPath,
  startWindowsDesktopShell,
  WINDOWS_DESKTOP_SHELL_SCRIPT,
  windowsPowerShellPath,
  type HostToShell,
  type ShellToHost,
} from '../src/windows-desktop-shell.ts'

describe('windows desktop shell protocol', () => {
  it('parses known tray commands and drops everything else', () => {
    expect(parseShellToHost('{"type":"show"}')).toEqual({ type: 'show' })
    expect(parseShellToHost('{"type":"start"}')).toEqual({ type: 'start' })
    expect(parseShellToHost('{"type":"stop"}')).toEqual({ type: 'stop' })
    expect(parseShellToHost('{"type":"restart"}')).toEqual({ type: 'restart' })
    expect(parseShellToHost('{"type":"settings"}')).toEqual({ type: 'settings' })
    expect(parseShellToHost('{"type":"listen","host":"0.0.0.0","port":8080}'))
      .toEqual({ type: 'listen', host: '0.0.0.0', port: 8080 })
    expect(parseShellToHost('{"type":"listen","host":"10.0.0.1","port":8080}')).toBeUndefined()
    expect(parseShellToHost('{"type":"listen","host":"127.0.0.1","port":-1}')).toBeUndefined()
    expect(parseShellToHost('{"type":"quit"}')).toEqual({ type: 'quit' })
    expect(parseShellToHost('')).toBeUndefined()
    expect(parseShellToHost('not-json')).toBeUndefined()
    expect(parseShellToHost('{"type":"progress"}')).toBeUndefined()
    expect(parseShellToHost('null')).toBeUndefined()
    expect(parseShellToHost('{"no":"type"}')).toBeUndefined()
  })

  it('serializes host commands as compact JSON', () => {
    const message: HostToShell = { type: 'progress', text: 'Starting…', zh: '正在启动…', percent: 20 }
    expect(formatHostToShell(message)).toBe(JSON.stringify(message))
    expect(formatHostToShell({ type: 'ready' })).toBe('{"type":"ready"}')
  })

  it('embeds the sibling PowerShell script byte-for-byte', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../src/windows-desktop-shell.ps1', import.meta.url)),
      'utf8',
    ).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
    expect(WINDOWS_DESKTOP_SHELL_SCRIPT).toBe(source)
    expect(source).toContain("T '显示主界面' 'Show main window'")
    expect(source).toContain("T '打开 http://127.0.0.1:3080' 'Open http://127.0.0.1:3080'")
    expect(source).toContain('T "打开 $url" "Open $url"')
    expect(source).toContain('function BrowseHost')
    expect(source).toContain('function ListenUrl')
    expect(source).toContain('Start-Process $url')
    expect(source).toContain('$itemOpenUrl.Enabled = [bool]$script:Running')
    expect(source).toContain("T '启动服务' 'Start service'")
    expect(source).toContain("T '停止服务' 'Stop service'")
    expect(source).toContain("T '重启服务' 'Restart service'")
    expect(source).toContain("T '监听地址…' 'Listen address…'")
    expect(source).toContain("T '系统设置' 'Settings'")
    expect(source).toContain("T '退出' 'Exit'")
    expect(source).toContain('$itemStart.Enabled = -not $script:Running')
    expect(source).toContain('$itemStop.Enabled = [bool]$script:Running')
    expect(source).toContain('$itemRestart.Enabled = [bool]$script:Running')
    expect(source).toContain('ShowListenDialog')
    expect(source).toContain('FocusListenForm')
    expect(source).toContain('$script:ListenForm.TopMost = $true')
    expect(source).toContain('function LoadDesktopIcon')
    expect(source).toContain('$env:DSH_WEB_ICON')
    expect(source).toContain("'dsh-web.ico'")
    expect(source).toContain('$splash.ShowInTaskbar = $false')
    expect(source).toContain('$script:ListenForm.ShowInTaskbar = $false')
    expect(source).toContain('[System.Windows.Forms.Application]::Run($hidden)')
    expect(source).toContain('SetUnhandledExceptionMode')
    expect(source).not.toContain('.ShowDialog(')
    expect(source).not.toContain('[Action]')
    // A control an event handler reads must live at script scope: PowerShell
    // discards a function's locals on return, so a captured local reads back
    // as $null when the click finally runs.
    expect(source).toContain('$chosenHost = [string]$script:ListenBindBox.SelectedItem')
    expect(source).toContain('$chosenPort = [int]$script:ListenPortBox.Value')
    // A raw thread running a scriptblock has no runspace and kills the process.
    expect(source).not.toContain('New-Object System.Threading.Thread')
  })
})

describe('desktop whale icon', () => {
  it('ships an ICO with the Windows magic header', () => {
    const ico = readFileSync(fileURLToPath(new URL('../assets/dsh-web.ico', import.meta.url)))
    expect(ico.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]))).toBe(true)
    expect(resolveDesktopIconPath('D:\\missing\\dsh-web.exe')).toMatch(/dsh-web\.ico$/i)
  })
})

describe('windowsPowerShellPath', () => {
  it('resolves Windows PowerShell 5.1 from SystemRoot', () => {
    expect(windowsPowerShellPath({ SystemRoot: 'D:\\Windows' }))
      .toBe(join('D:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'))
    expect(windowsPowerShellPath({})).toBe(join('C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'))
  })
})

describe('startWindowsDesktopShell', () => {
  it('writes the script, hides PowerShell, and relays JSON lines', () => {
    const written: Array<{ file: string; contents: string }> = []
    const unlinked: string[] = []
    const stdinChunks: string[] = []
    const stdout = new EventEmitter() as EventEmitter & { setEncoding(enc: string): void }
    stdout.setEncoding = () => undefined
    const child = Object.assign(new EventEmitter(), {
      stdin: {
        write(chunk: string) {
          stdinChunks.push(chunk)
          return true
        },
      },
      stdout,
      kill() {
        child.emit('exit')
        return true
      },
    })
    const spawned: Array<{ command: string; args: readonly string[]; env: NodeJS.ProcessEnv }> = []
    const shell = startWindowsDesktopShell({
      parentPid: 4242,
      execPath: 'D:\\dist\\dsh-web.exe',
      scriptDir: 'D:\\home',
      env: { SystemRoot: 'D:\\Windows', PATH: 'D:\\Windows\\System32' },
      spawn(command, args, env) {
        spawned.push({ command, args, env })
        return child
      },
      writeFile(file, contents) {
        written.push({ file, contents })
      },
      unlink(file) {
        unlinked.push(file)
      },
    })
    expect(written).toHaveLength(1)
    expect(written[0]?.contents).toBe(WINDOWS_DESKTOP_SHELL_SCRIPT)
    expect(written[0]?.file).toMatch(/desktop-shell-4242-\d+\.ps1$/)
    expect(written[0]?.file.startsWith('D:\\home')).toBe(true)
    expect(spawned[0]?.command).toBe(join('D:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'))
    expect(spawned[0]?.args.slice(0, 6)).toEqual([
      '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
    ])
    expect(spawned[0]?.args[6]).toBe('-File')
    expect(spawned[0]?.args[7]).toBe(written[0]?.file)
    expect(spawned[0]?.env.DSH_WEB_PARENT_PID).toBe('4242')
    expect(spawned[0]?.env.DSH_WEB_EXE).toBe('D:\\dist\\dsh-web.exe')
    expect(spawned[0]?.env.DSH_WEB_ICON).toMatch(/dsh-web\.ico$/i)

    const commands: ShellToHost[] = []
    shell.onCommand((command) => { commands.push(command) })
    stdout.emit('data', '{"type":"show"}\n{"type":"unknown"}\n{"type":"quit"}\n')
    expect(commands).toEqual([{ type: 'show' }, { type: 'quit' }])

    shell.send({ type: 'ready' })
    expect(stdinChunks).toEqual(['{"type":"ready"}\n'])

    const exits: number[] = []
    shell.onExit(() => { exits.push(1) })
    shell.close()
    expect(stdinChunks.at(-1)).toBe('{"type":"quit"}\n')
    expect(unlinked).toContain(written[0]?.file)
    expect(exits).toEqual([])
  })

  it('reports unexpected tray exit and ignores a second close', () => {
    const stdout = new EventEmitter() as EventEmitter & { setEncoding(enc: string): void }
    stdout.setEncoding = () => undefined
    const child = Object.assign(new EventEmitter(), {
      stdin: { write() { return true } },
      stdout,
      kill() { return true },
    })
    const shell = startWindowsDesktopShell({
      parentPid: 1,
      execPath: 'x.exe',
      scriptDir: 'h',
      spawn: () => child,
      writeFile() { /* unused */ },
      unlink() { /* unused */ },
    })
    const exits: number[] = []
    shell.onExit(() => { exits.push(1) })
    child.emit('exit')
    expect(exits).toEqual([1])
    shell.close()
    shell.close()
  })
})
