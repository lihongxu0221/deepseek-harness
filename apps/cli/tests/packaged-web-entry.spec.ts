import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  extraPackagedArgv,
  PACKAGED_WEB_CLI_REL,
  PACKAGED_WEB_ENTRY_REL,
  packagedCliArgv,
  packagedEvalSource,
  packagedWebShouldChdir,
  packagedMarketCliAliasName,
  prependPackagedBinToPath,
  resolvePackagedCliEntry,
  withPackagedMarketCliArgv,
  resolvePackagedScriptArg,
  resolvePackagedWebEntry,
  withPackagedScriptArgv,
} from '../src/packaged-web-entry.ts'

function wrapLauncherChildProcess(attachHiddenConsole: () => boolean) {
  const launcher = readFileSync(fileURLToPath(new URL('../packaged-web-launcher.cjs', import.meta.url)), 'utf8')
  const guard = "if (process.platform === 'win32') {"
  const start = launcher.indexOf(guard)
  const end = launcher.indexOf('const SCRIPT_EXTS')
  expect(start).toBeGreaterThan(-1)
  const body = launcher.slice(start + guard.length, end).replace(/\}\s*$/u, '')
  const seen: unknown[][] = []
  const record = (name: string) =>
    (...callArgs: unknown[]): unknown => {
      seen.push([name, ...callArgs])
      return { pid: 0 }
    }
  const cp = {
    spawn: record('spawn'),
    spawnSync: record('spawnSync'),
    exec: record('exec'),
    execSync: record('execSync'),
    execFile: record('execFile'),
    execFileSync: record('execFileSync'),
  }
  const build = new Function(
    'cp',
    'attachHiddenConsole',
    body +
      '\nreturn { spawn: cp.spawn, spawnSync: cp.spawnSync, exec: cp.exec, execSync: cp.execSync, execFile: cp.execFile, execFileSync: cp.execFileSync }',
  )
  const wrapped = build(cp, attachHiddenConsole) as {
    spawn: (...callArgs: unknown[]) => unknown
    spawnSync: (...callArgs: unknown[]) => unknown
    exec: (...callArgs: unknown[]) => unknown
    execSync: (...callArgs: unknown[]) => unknown
    execFile: (...callArgs: unknown[]) => unknown
    execFileSync: (...callArgs: unknown[]) => unknown
  }
  return { seen, wrapped }
}

describe('resolvePackagedWebEntry', () => {
  it('resolves lib/packaged-web-bin.js beside the launcher and refuses a missing file', () => {
    const execPath = join('D:\\dist', 'dsh-web.exe')
    const expected = join('D:\\dist', PACKAGED_WEB_ENTRY_REL)
    expect(resolvePackagedWebEntry(execPath, path => path === expected)).toBe(expected)
    expect(() => resolvePackagedWebEntry(execPath, () => false)).toThrow(/Keep this executable inside the built folder/)
  })

  it('keeps the pkg SEA launcher in CommonJS so the embedder can run it', () => {
    const launcher = readFileSync(fileURLToPath(new URL('../packaged-web-launcher.cjs', import.meta.url)), 'utf8')
    expect(launcher).toMatch(/require\('node:path'\)/)
    expect(launcher).not.toMatch(/^import /m)
    expect(launcher).toContain("join(dirname(process.execPath), 'lib', 'packaged-web-bin.js')")
    expect(launcher).toContain('Keep this executable inside the built folder')
    expect(launcher).toContain('resolvePackagedScriptArg')
    expect(launcher).toContain('process.argv = [process.execPath, script, ...extra.slice(1)]')
    expect(launcher).toContain('isInvocationEcho(value, process.execPath)')
    expect(launcher).toContain("INVOCATION_STEMS = new Set(['dsh', 'dsh-web'])")
    expect(launcher).toContain("join(dirname(process.execPath), 'lib', 'bin.js')")
    // A GUI host attaches a hidden console and wraps child_process before any
    // ESM import creates the builtin facade, so CUI grandchildren inherit that
    // console instead of allocating a visible empty window.
    expect(launcher).toContain("require('node:child_process')")
    expect(launcher).toContain('function attachHiddenConsole()')
    expect(launcher).toContain('AllocConsole')
    expect(launcher).toContain('SetStdHandle')
    expect(launcher).toContain('const inheritHiddenConsole = attachHiddenConsole()')
    expect(launcher).toContain('visible, empty console window')
    expect(launcher).toContain('cp.spawn = wrapArgv(cp.spawn)')
    expect(launcher).toContain('cp.spawnSync = wrapArgv(cp.spawnSync)')
    expect(launcher).toContain('cp.exec = wrapExec(cp.exec)')
    expect(launcher).toContain('cp.execSync = wrapExec(cp.execSync)')
    expect(launcher).toContain('cp.execFile = wrapExecFile(cp.execFile)')
    expect(launcher).toContain('cp.execFileSync = wrapExecFile(cp.execFileSync)')
    const wrapAt = launcher.indexOf('process.platform === \'win32\'', launcher.indexOf("require('node:child_process')"))
    expect(wrapAt).toBeGreaterThan(-1)
    expect(wrapAt).toBeLessThan(launcher.indexOf('const SCRIPT_EXTS'))
    expect(launcher).toContain('.cjs')
  })

  it('forces windowsHide onto every documented child_process call shape', () => {
    // Evaluate the wrap against recording stand-ins so every branch is
    // exercised without spawning real children.
    const { seen, wrapped } = wrapLauncherChildProcess(() => false)
    const noop = (): void => {}
    wrapped.spawn('git')
    wrapped.spawn('git', ['-v'])
    wrapped.spawn('git', ['-v'], { stdio: 'pipe' })
    wrapped.exec('git status', noop)
    wrapped.execSync('git diff')
    wrapped.execFileSync('git', ['diff'], { cwd: 'X' })
    wrapped.execFile('git', noop)
    wrapped.execFile('git', ['log'], noop)
    wrapped.execFile('git', { cwd: 'X' }, noop)

    for (const entry of seen) {
      const options = entry
        .slice(1)
        .filter(arg => arg !== null && typeof arg === 'object' && !Array.isArray(arg))
        .pop() as { windowsHide?: boolean } | undefined
      expect(options?.windowsHide).toBe(true)
    }
    expect(seen[1]!.slice(2)).toEqual([['-v'], { windowsHide: true }])
    expect(seen[2]![3]).toEqual({ stdio: 'pipe', windowsHide: true })
    expect(typeof seen[3]![3]).toBe('function')
    expect(seen[4]![1]).toBe('git diff')
    expect(seen[5]![2]).toEqual(['diff'])
    expect((seen[5]![3] as { cwd: string }).cwd).toBe('X')
    expect(typeof seen[6]![3]).toBe('function')
    expect(seen[7]![2]).toEqual(['log'])
    expect(typeof seen[7]![4]).toBe('function')
    expect(typeof seen[8]![3]).toBe('function')
    expect((seen[8]![2] as { cwd: string }).cwd).toBe('X')

    // A caller-owned windowsHide wins over the injected product default:
    // GUI-window spawners declare false and must keep it.
    wrapped.spawn('git', ['-v'], { stdio: 'ignore', windowsHide: false })
    wrapped.spawn('git', ['-v'], { stdio: 'ignore', windowsHide: true })
    expect(seen[9]![3]).toEqual({ stdio: 'ignore', windowsHide: false })
    expect(seen[10]![3]).toEqual({ stdio: 'ignore', windowsHide: true })
  })

  it('does not inject windowsHide when a hidden console is already attached', () => {
    const { seen, wrapped } = wrapLauncherChildProcess(() => true)
    wrapped.spawn('git', ['-v'])
    wrapped.spawn('git', ['-v'], { stdio: 'pipe' })
    wrapped.spawn('git', ['-v'], { stdio: 'ignore', windowsHide: false })
    expect(seen[0]![3]).toEqual({})
    expect(seen[1]![3]).toEqual({ stdio: 'pipe' })
    expect(seen[2]![3]).toEqual({ stdio: 'ignore', windowsHide: false })
  })
})

describe('extraPackagedArgv', () => {
  const launcher = resolve('D:\\dist\\packaged-web-launcher.cjs')
  const entry = resolve('D:\\dist\\lib\\packaged-web-bin.js')
  const worker = resolve('D:\\dist\\node_modules\\@deepseek-ai\\dsh-host-directory-picker-native\\lib\\worker.cjs')

  it('drops the node/SEA launcher slot and keeps a worker script', () => {
    expect(extraPackagedArgv(['D:\\dist\\dsh-web.exe', launcher, worker], launcher)).toEqual([worker])
    expect(extraPackagedArgv(['node', launcher, worker], launcher)).toEqual([worker])
    expect(extraPackagedArgv(['D:\\dist\\dsh-web.exe', entry, worker], entry)).toEqual([worker])
  })

  it('keeps a lone worker argument when the SEA omits the launcher path', () => {
    expect(extraPackagedArgv(['D:\\dist\\dsh-web.exe', worker], launcher)).toEqual([worker])
  })

  it('skips a pkg-duplicated execPath before the worker script', () => {
    expect(extraPackagedArgv(['D:\\dist\\dsh-web.exe', 'D:/dist/dsh-web.exe', worker], launcher)).toEqual([worker])
  })

  it('returns no extras for a double-click argv', () => {
    expect(extraPackagedArgv(['D:\\dist\\dsh-web.exe'], launcher)).toEqual([])
    expect(extraPackagedArgv(['D:\\dist\\dsh-web.exe', launcher], launcher)).toEqual([])
  })

  it('keeps a plugin CLI invocation after dropping launcher slots', () => {
    const plugin = ['plugin', '--profile', 'web', 'add', 'github:owner/repo#path:/skin']
    expect(extraPackagedArgv(['D:\\dist\\dsh-web.exe', launcher, ...plugin], launcher)).toEqual(plugin)
    expect(extraPackagedArgv(['D:\\dist\\dsh.exe', ...plugin], launcher)).toEqual(plugin)
  })

  it('drops the invocation echo the SEA preserves when a shell passed the token as typed', () => {
    const plugin = ['plugin', '--profile', 'web', 'add', 'dshmarket@latest']
    const exec = resolve('D:\\dist\\dsh.exe')
    expect(extraPackagedArgv([exec, 'dsh', ...plugin], launcher, exec)).toEqual(plugin)
    expect(extraPackagedArgv([exec, 'dsh.exe', ...plugin], launcher, exec)).toEqual(plugin)
    expect(extraPackagedArgv([exec, 'D:/dist/dsh.exe', ...plugin], launcher, exec)).toEqual(plugin)
    expect(extraPackagedArgv([exec, 'dsh', '-e', 'console.log(1)'], launcher, exec)).toEqual(['-e', 'console.log(1)'])
    const worker = resolve('D:\\dist\\worker.cjs')
    expect(extraPackagedArgv([exec, 'dsh', worker], launcher, exec)).toEqual([worker])
    const web = resolve('D:\\dist\\dsh-web.exe')
    expect(extraPackagedArgv([web, 'dsh', ...plugin], launcher, web)).toEqual(plugin)
    expect(extraPackagedArgv([web, 'dsh-web', ...plugin], launcher, web)).toEqual(plugin)
    expect(extraPackagedArgv([web, join('D:\\dist', 'lib', 'bin.js'), ...plugin], launcher, web)).toEqual(plugin)
  })

  it('never treats a leading option or an unrelated name as the invocation echo', () => {
    const exec = resolve('D:\\dist\\dsh.exe')
    expect(extraPackagedArgv([exec, '--port', '8080'], launcher, exec)).toEqual(['--port', '8080'])
    expect(extraPackagedArgv([exec, 'web', '--port', '8080'], launcher, exec)).toEqual(['web', '--port', '8080'])
  })
})

describe('resolvePackagedScriptArg', () => {
  const worker = resolve('D:\\dist\\worker.cjs')

  it('resolves an existing script and ignores everything else', () => {
    expect(resolvePackagedScriptArg([worker], path => path === worker)).toBe(worker)
    expect(resolvePackagedScriptArg([worker], () => false)).toBeUndefined()
    expect(resolvePackagedScriptArg(['--port', '8080'], () => true)).toBeUndefined()
    expect(resolvePackagedScriptArg([], () => true)).toBeUndefined()
  })
})

describe('withPackagedScriptArgv', () => {
  it('puts the resolved script in argv[1] so slice(2) is only the worker flags', () => {
    const exec = resolve('D:\\dist\\dsh-web.exe')
    const runner = resolve('D:\\dist\\node_modules\\@deepseek-ai\\dsh-sandbox-windows-acl\\lib\\runner.js')
    expect(withPackagedScriptArgv(exec, runner, [runner, '--workspace', 'D:\\ws', '--', 'pwsh'])).toEqual([
      exec,
      runner,
      '--workspace',
      'D:\\ws',
      '--',
      'pwsh',
    ])
    expect(withPackagedScriptArgv(exec, runner, ['relative\\runner.js', '--mode', 'workspace-write']).slice(2))
      .toEqual(['--mode', 'workspace-write'])
  })
})

describe('packagedCliArgv', () => {
  it('returns CLI argv and ignores GUI extras', () => {
    const plugin = ['plugin', '--profile', 'web', 'add', 'github:owner/repo#path:/skin']
    expect(packagedCliArgv(plugin)).toEqual(plugin)
    expect(packagedCliArgv(['plugin'])).toEqual(['plugin'])
    expect(packagedCliArgv(['--profile', 'headless', 'run tests'])).toEqual(['--profile', 'headless', 'run tests'])
    expect(packagedCliArgv(['--help'])).toEqual(['--help'])
    expect(packagedCliArgv(['--dump-config'])).toEqual(['--dump-config'])
    expect(packagedCliArgv([])).toBeUndefined()
    expect(packagedCliArgv(['--port', '8080'])).toBeUndefined()
    expect(packagedCliArgv(['web'])).toBeUndefined()
    expect(packagedCliArgv(['--input-type=module'])).toBeUndefined()
  })
})

describe('packagedWebShouldChdir', () => {
  it('keeps the invoking cwd for CLI heads and chdirs only for the GUI branch', () => {
    expect(packagedWebShouldChdir(['plugin', '--profile', 'web', 'add', '.'])).toBe(false)
    expect(packagedWebShouldChdir(['--profile', 'web', '--patch', './overlay.yml'])).toBe(false)
    expect(packagedWebShouldChdir(['--dump-config'])).toBe(false)
    expect(packagedWebShouldChdir([])).toBe(true)
    expect(packagedWebShouldChdir(['--port', '8080'])).toBe(true)
  })
})

describe('resolvePackagedCliEntry', () => {
  it('resolves lib/bin.js beside the launcher and refuses a missing file', () => {
    const execPath = join('D:\\dist', 'dsh-web.exe')
    const expected = join('D:\\dist', PACKAGED_WEB_CLI_REL)
    expect(resolvePackagedCliEntry(execPath, path => path === expected)).toBe(expected)
    expect(() => resolvePackagedCliEntry(execPath, () => false)).toThrow(/Keep this executable inside the built folder/)
  })
})

describe('prependPackagedBinToPath', () => {
  it('prepends the executable directory to a win32 PATH once', () => {
    const env: { PATH?: string } = { PATH: 'C:\\Windows;C:\\Windows\\System32' }
    prependPackagedBinToPath('D:\\dist\\dsh.exe', env, 'win32')
    expect(env.PATH).toBe('D:\\dist;C:\\Windows;C:\\Windows\\System32')
    prependPackagedBinToPath('D:\\dist\\dsh.exe', env, 'win32')
    expect(env.PATH).toBe('D:\\dist;C:\\Windows;C:\\Windows\\System32')
  })

  it('creates a PATH when the environment carries none', () => {
    const env: { PATH?: string } = {}
    prependPackagedBinToPath('D:\\dist\\dsh.exe', env, 'win32')
    expect(env.PATH).toBe('D:\\dist')
  })

  it('treats an existing entry case-insensitively and leaves other platforms alone', () => {
    const env: { PATH?: string } = { PATH: 'C:\\Windows;d:\\DIST' }
    prependPackagedBinToPath('D:\\dist\\dsh.exe', env, 'win32')
    expect(env.PATH).toBe('C:\\Windows;d:\\DIST')
    const posix: { PATH?: string } = { PATH: '/usr/bin' }
    prependPackagedBinToPath('/opt/dist/dsh', posix, 'linux')
    expect(posix.PATH).toBe('/usr/bin')
  })
})

describe('packagedMarketCliAliasName', () => {
  it('names the market PATH fallback beside the product launcher', () => {
    expect(packagedMarketCliAliasName('win')).toBe('dsh.exe')
    expect(packagedMarketCliAliasName('win32')).toBe('dsh.exe')
    expect(packagedMarketCliAliasName('linux')).toBe('dsh')
    expect(packagedMarketCliAliasName('darwin')).toBe('dsh')
  })
})

describe('withPackagedMarketCliArgv', () => {
  it('points argv[1] at lib/bin.js so a market spawn could name the CLI entry', () => {
    const exec = resolve('D:\\dist\\dsh-web.exe')
    expect(withPackagedMarketCliArgv(exec, [exec, resolve('D:\\dist\\lib\\packaged-web-bin.js')])).toEqual([
      exec,
      join('D:\\dist', 'lib', 'bin.js'),
    ])
  })
})

describe('packagedEvalSource', () => {
  it('returns the source after -e/--eval and nothing for other heads', () => {
    expect(packagedEvalSource(['-e', 'console.log(1)'])).toBe('console.log(1)')
    expect(packagedEvalSource(['--eval', 'process.exit(0)'])).toBe('process.exit(0)')
    expect(packagedEvalSource(['-e'])).toBeUndefined()
    expect(packagedEvalSource(['--port', '8080'])).toBeUndefined()
    expect(packagedEvalSource(['plugin'])).toBeUndefined()
    expect(packagedEvalSource([])).toBeUndefined()
  })
})
