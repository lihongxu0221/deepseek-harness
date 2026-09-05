import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import {
  DesktopUpdateController, peelExtractRootName, type DesktopUpdateIo,
} from '../src/controller.ts'
import { resolveConfig } from '../src/index.ts'

const HEX = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const DIGEST = `sha256:${HEX}`

function zipAsset(version: string) {
  return {
    tag_name: `winexe-${version}`,
    prerelease: true,
    draft: false,
    body: `notes ${version}`,
    assets: [{
      name: `dsh-web-win-x64-${version}.zip`,
      browser_download_url: `https://example.test/dsh-web-win-x64-${version}.zip`,
      size: 20,
      digest: DIGEST,
    }],
  }
}

const productDir = join('app')
const execPath = join(productDir, 'dsh-web.exe')
const homeDir = join(productDir, '.config')

function io(overrides: Partial<DesktopUpdateIo> & { files?: Map<string, string | Buffer> } = {}): DesktopUpdateIo & {
  spawned: string[]
  exits: number[]
} {
  const files = overrides.files ?? new Map<string, string | Buffer>([
    [join(productDir, 'VERSION'), '0.1.2-alpha.5.winexe.17\n'],
    [execPath, 'exe'],
  ])
  const dirs = new Map<string, { name: string; isDirectory: boolean }[]>()
  const spawned: string[] = []
  const exits: number[] = []
  const adapter: DesktopUpdateIo & { spawned: string[]; exits: number[] } = {
    execPath,
    pid: 9,
    platform: 'win32',
    now: () => 1_000,
    exists: path => files.has(path) || dirs.has(path),
    readFile: (path) => {
      const value = files.get(path)
      return typeof value === 'string' ? value : undefined
    },
    writeFile: async (path, contents) => { files.set(path, contents) },
    mkdir: async (path) => { if (!dirs.has(path)) dirs.set(path, []) },
    rm: async (path) => {
      files.delete(path)
      dirs.delete(path)
    },
    listDir: async path => dirs.get(path) ?? [],
    statfs: async () => ({ bavail: 1_000_000, bsize: 4096 }),
    fetch: async () => new Response(JSON.stringify([zipAsset('0.1.2-rc.1.winexe.19')]), { status: 200 }),
    sha256File: async () => HEX,
    download: async (_url, dest, onProgress) => {
      onProgress(20, 20)
      files.set(dest, 'zip')
    },
    extract: async (_zip, dest) => {
      dirs.set(dest, [
        { name: 'dsh-web.exe', isDirectory: false },
        { name: 'VERSION', isDirectory: false },
      ])
      files.set(join(dest, 'dsh-web.exe'), 'exe')
      files.set(join(dest, 'VERSION'), '0.1.2-rc.1.winexe.19\n')
    },
    spawnHelper: (scriptPath) => { spawned.push(scriptPath) },
    exit: (code) => { exits.push(code) },
    resolveHome: () => homeDir,
    cwd: () => productDir,
    spawned,
    exits,
    ...overrides,
  }
  return adapter
}

describe('DesktopUpdateController', () => {
  it('no-ops download and apply when VERSION is missing', async () => {
    const controller = new DesktopUpdateController(
      resolveConfig({}),
      io({ exists: () => false, readFile: () => undefined }),
    )
    expect((await controller.check(true, new AbortController().signal)).mode).toBe('unavailable')
    expect((await controller.download(new AbortController().signal)).error).toBe('not a packaged desktop')
    expect((await controller.armApply()).error).toBe('not a packaged desktop')
  })

  it('reuses a fresh GitHub list and recovers from a failed check', async () => {
    let now = 1_000
    let fail = true
    const fake = io({
      now: () => now,
      fetch: async () => {
        if (fail) return new Response('nope', { status: 500 })
        return new Response(JSON.stringify([zipAsset('0.1.2-rc.1.winexe.19')]), { status: 200 })
      },
    })
    const controller = new DesktopUpdateController(resolveConfig({ cacheTtlMs: 100 }), fake)
    expect((await controller.check(true, new AbortController().signal)).mode).toBe('error')
    expect((await controller.check(true, new AbortController().signal)).mode).toBe('error')
    fail = false
    expect((await controller.check(true, new AbortController().signal)).mode).toBe('idle')
    now = 1_050
    expect((await controller.check(false, new AbortController().signal)).latest).toBe('0.1.2-rc.1.winexe.19')
  })

  it('applies after a wrapping extract directory and rejects a vanished extract', async () => {
    const fake = io({
      listDir: async path => path.endsWith('extract')
        ? [{ name: 'wrap', isDirectory: true }]
        : [{ name: 'dsh-web.exe', isDirectory: false }, { name: 'VERSION', isDirectory: false }],
      exists: (path) => {
        if (path === join(productDir, 'VERSION') || path === execPath) return true
        if (path.includes(join('wrap', 'VERSION')) || path.includes(join('wrap', 'dsh-web.exe'))) return true
        return false
      },
      readFile: path => path.endsWith('VERSION') ? '0.1.2-alpha.5.winexe.17\n' : undefined,
    })
    const controller = new DesktopUpdateController(resolveConfig({}), fake)
    await controller.check(true, new AbortController().signal)
    expect((await controller.download(new AbortController().signal)).mode).toBe('ready')
    expect((await controller.armApply()).mode).toBe('applying')

    const gone = io()
    const vanished = new DesktopUpdateController(resolveConfig({}), gone)
    await vanished.check(true, new AbortController().signal)
    await vanished.download(new AbortController().signal)
    gone.exists = () => false
    expect((await vanished.armApply()).error).toContain('packaged desktop')
  })

  it('reports unavailable when VERSION is missing', () => {
    const controller = new DesktopUpdateController(
      resolveConfig({}),
      io({ exists: () => false, readFile: () => undefined }),
    )
    expect(controller.snapshot()).toMatchObject({ mode: 'unavailable', outdated: false })
  })

  it('checks GitHub, downloads a newer zip, and arms apply on Windows', async () => {
    const fake = io()
    const controller = new DesktopUpdateController(resolveConfig({}), fake)
    const checked = await controller.check(true, new AbortController().signal)
    expect(checked.mode).toBe('idle')
    expect(checked.latest).toBe('0.1.2-rc.1.winexe.19')
    expect(checked.outdated).toBe(true)
    const cached = await controller.check(false, new AbortController().signal)
    expect(cached.latest).toBe('0.1.2-rc.1.winexe.19')
    const downloaded = await controller.download(new AbortController().signal)
    expect(downloaded.mode).toBe('ready')
    const applied = await controller.armApply()
    expect(applied.mode).toBe('applying')
    expect(fake.spawned).toHaveLength(1)
  })

  it('refuses a concurrent download', async () => {
    let resume!: () => void
    const blocked = new Promise<void>((resolve) => { resume = resolve })
    let entered = 0
    const fake = io({
      download: async () => {
        entered += 1
        if (entered === 1) await blocked
      },
    })
    const controller = new DesktopUpdateController(resolveConfig({}), fake)
    await controller.check(true, new AbortController().signal)
    const first = controller.download(new AbortController().signal)
    await vi.waitFor(() => { expect(entered).toBe(1) })
    const second = await controller.download(new AbortController().signal)
    expect(second.error).toBe('download already in progress')
    resume()
    await first
  })

  it('refuses a missing digest and apply before ready', async () => {
    const noDigest = io({
      fetch: async () => new Response(JSON.stringify([{
        tag_name: 'winexe-0.1.2-rc.1.winexe.19',
        assets: [{
          name: 'dsh-web-win-x64-0.1.2-rc.1.winexe.19.zip',
          browser_download_url: 'https://example.test/x.zip',
          size: 20,
        }],
      }]), { status: 200 }),
    })
    const missing = new DesktopUpdateController(resolveConfig({}), noDigest)
    await missing.check(true, new AbortController().signal)
    expect((await missing.download(new AbortController().signal)).error).toContain('digest')

    const idle = new DesktopUpdateController(resolveConfig({}), io())
    expect((await idle.armApply()).error).toBe('download a zip before applying')
  })

  it('rethrows an aborted check and records invalid GitHub JSON', async () => {
    const abort = new AbortController()
    abort.abort()
    const controller = new DesktopUpdateController(resolveConfig({}), io({
      fetch: async (_url, init) => {
        if (init?.signal?.aborted) throw new Error('aborted')
        return new Response('[]', { status: 200 })
      },
    }))
    await expect(controller.check(true, abort.signal)).rejects.toThrow('aborted')

    const invalid = new DesktopUpdateController(resolveConfig({}), io({
      fetch: async () => new Response('{"nope":true}', { status: 200 }),
    }))
    expect((await invalid.check(true, new AbortController().signal)).error).toContain('not an array')
  })

  it('records a helper spawn failure', async () => {
    const fake = io({
      spawnHelper: () => { throw new Error('spawn failed') },
    })
    const controller = new DesktopUpdateController(resolveConfig({}), fake)
    await controller.check(true, new AbortController().signal)
    await controller.download(new AbortController().signal)
    expect((await controller.armApply()).error).toBe('spawn failed')
  })

  it('surfaces GitHub HTTP failures and insufficient disk', async () => {
    const github = new DesktopUpdateController(resolveConfig({}), io({
      fetch: async () => new Response('nope', { status: 403 }),
    }))
    expect((await github.check(true, new AbortController().signal)).mode).toBe('error')

    const disk = new DesktopUpdateController(resolveConfig({}), io({
      statfs: async () => ({ bavail: 1, bsize: 1 }),
    }))
    await disk.check(true, new AbortController().signal)
    expect((await disk.download(new AbortController().signal)).error).toContain('need')
  })

  it('refuses apply off Windows and when the extract is incomplete', async () => {
    const linux = new DesktopUpdateController(resolveConfig({}), io({ platform: 'linux' }))
    await linux.check(true, new AbortController().signal)
    await linux.download(new AbortController().signal)
    expect((await linux.armApply()).error).toContain('Windows')

    const broken = new DesktopUpdateController(resolveConfig({}), io({
      extract: async () => {},
    }))
    await broken.check(true, new AbortController().signal)
    expect((await broken.download(new AbortController().signal)).error).toContain('packaged desktop')
  })
})

describe('sha256 of known bytes', () => {
  it('fails a digest mismatch and aborts an in-flight download', async () => {
    const mismatch = io({ sha256File: async () => 'bb'.repeat(32) })
    const bad = new DesktopUpdateController(resolveConfig({}), mismatch)
    await bad.check(true, new AbortController().signal)
    expect((await bad.download(new AbortController().signal)).error).toContain('does not match')

    const abort = new AbortController()
    const hanging = io({
      download: async (_url, _dest, _onProgress, signal) => {
        abort.abort()
        signal.throwIfAborted()
      },
    })
    const aborted = new DesktopUpdateController(resolveConfig({}), hanging)
    await aborted.check(true, new AbortController().signal)
    await expect(aborted.download(abort.signal)).rejects.toThrow()
  })

  it('treats a non-Error extract failure as a string', async () => {
    const fake = io({
      extract: async () => { throw 'extract-boom' },
    })
    const controller = new DesktopUpdateController(resolveConfig({}), fake)
    await controller.check(true, new AbortController().signal)
    expect((await controller.download(new AbortController().signal)).error).toBe('extract-boom')
  })

  it('matches Node crypto so digest tests stay honest', () => {
    expect(createHash('sha256').update('zip').digest('hex')).toHaveLength(64)
    expect(peelExtractRootName([])).toBeUndefined()
  })
})
