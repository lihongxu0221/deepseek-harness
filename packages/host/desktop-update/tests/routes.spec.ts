import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  apply, Config, createDefaultIo, DESKTOP_UPDATE_PATHS, inject, mountDesktopUpdate,
  name, resolveConfig,
} from '../src/index.ts'
import type { DesktopUpdateIo } from '../src/controller.ts'

const routes: Array<{
  path: string
  methods: readonly string[]
  fetch: (request: Request) => Promise<Response>
}> = []

function ctxWithConnection(): Context {
  routes.length = 0
  const ctx = new Context()
  ctx.provide('connection', {
    fetch: {
      register(route: (typeof routes)[number]) {
        routes.push(route)
        return async () => {
          const index = routes.indexOf(route)
          if (index >= 0) routes.splice(index, 1)
        }
      },
    },
  })
  return ctx
}

function handler(path: string) {
  const route = routes.find(entry => entry.path === path)
  if (route === undefined) throw new Error(`missing ${path}`)
  return route.fetch
}

function zipAsset() {
  return {
    tag_name: 'winexe-0.1.2-rc.1.winexe.19',
    prerelease: true,
    draft: false,
    body: '',
    assets: [{
      name: 'dsh-web-win-x64-0.1.2-rc.1.winexe.19.zip',
      browser_download_url: 'https://example.test/x.zip',
      size: 20,
      digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    }],
  }
}

const productDir = join('app')
const files = new Map<string, string>([[join(productDir, 'VERSION'), '0.1.0\n']])

function testIo(overrides: Partial<DesktopUpdateIo> = {}): DesktopUpdateIo {
  return {
    execPath: join(productDir, 'dsh-web.exe'),
    pid: 1,
    platform: 'win32',
    now: () => 0,
    exists: path => files.has(path),
    readFile: path => files.get(path),
    writeFile: async () => {},
    mkdir: async () => {},
    rm: async () => {},
    listDir: async () => [],
    statfs: async () => ({ bavail: 1, bsize: 1 }),
    fetch: async () => new Response('[]', { status: 200 }),
    sha256File: async () => '00',
    download: async () => {},
    extract: async () => {},
    spawnHelper: () => {},
    exit: () => {},
    resolveHome: () => join(productDir, '.config'),
    cwd: () => productDir,
    ...overrides,
  }
}

describe('resolveConfig', () => {
  it('applies defaults and rejects a malformed repository or prefix', () => {
    expect(name).toBe('desktop-update')
    expect(inject).toEqual(['connection'])
    expect(resolveConfig({}).repository).toBe('lihongxu0221/deepseek-harness')
    expect(() => resolveConfig({ repository: 'nope' })).toThrow('owner/name')
    expect(() => resolveConfig({ assetPrefix: '../x' })).toThrow('filename prefix')
    expect(() => resolveConfig({ assetPrefix: '' })).toThrow('filename prefix')
    expect(Config({ repository: 'acme/desktop' })).toMatchObject({ repository: 'acme/desktop' })
  })
})

describe('mountDesktopUpdate', () => {
  it('fences non-loopback requests and serves status on loopback', async () => {
    const ctx = ctxWithConnection()
    mountDesktopUpdate(ctx, resolveConfig({ checkOnBoot: false }), testIo())
    const status = handler(DESKTOP_UPDATE_PATHS.status)
    const forbidden = await status(new Request('http://192.168.1.9/api/desktop-update/status'))
    expect(forbidden.status).toBe(403)
    expect(await forbidden.json()).toEqual({ ok: false, code: 'forbidden' })
    const ok = await status(new Request('http://127.0.0.1/api/desktop-update/status'))
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ mode: 'idle', current: '0.1.0' })
    const progress = await handler(DESKTOP_UPDATE_PATHS.progress)(
      new Request('http://127.0.0.1/api/desktop-update/progress'),
    )
    expect(progress.status).toBe(200)
    await ctx.fiber.dispose()
    expect(routes).toEqual([])
  })

  it('checks, rejects a download without a newer zip, and does not exit on a failed apply', async () => {
    const exits: number[] = []
    const ctx = ctxWithConnection()
    mountDesktopUpdate(ctx, resolveConfig({ checkOnBoot: false }), testIo({
      exit: (code) => { exits.push(code) },
    }))
    const checked = await handler(DESKTOP_UPDATE_PATHS.check)(
      new Request('http://127.0.0.1/api/desktop-update/check', { method: 'POST' }),
    )
    expect(checked.status).toBe(200)
    const downloaded = await handler(DESKTOP_UPDATE_PATHS.download)(
      new Request('http://127.0.0.1/api/desktop-update/download', { method: 'POST' }),
    )
    expect(downloaded.status).toBe(200)
    expect((await downloaded.json() as { error: string }).error).toBe('no newer packaged zip')
    const applied = await handler(DESKTOP_UPDATE_PATHS.apply)(
      new Request('http://127.0.0.1/api/desktop-update/apply', { method: 'POST' }),
    )
    expect(applied.status).toBe(200)
    expect(exits).toEqual([])
    await ctx.fiber.dispose()
  })

  it('returns 409 while a download is in flight and exits after apply', async () => {
    let resume!: () => void
    const blocked = new Promise<void>((resolve) => { resume = resolve })
    let entered = 0
    const exits: number[] = []
    const files = new Map<string, string>([
      [join(productDir, 'VERSION'), '0.1.2-alpha.5.winexe.17\n'],
      [join(productDir, 'dsh-web.exe'), 'exe'],
    ])
    const ctx = ctxWithConnection()
    mountDesktopUpdate(ctx, resolveConfig({ checkOnBoot: false }), testIo({
      exists: path => files.has(path) || path.includes('extract'),
      readFile: path => files.get(path),
      fetch: async () => new Response(JSON.stringify([{
        tag_name: 'winexe-0.1.2-rc.1.winexe.19',
        prerelease: true,
        draft: false,
        body: '',
        assets: [{
          name: 'dsh-web-win-x64-0.1.2-rc.1.winexe.19.zip',
          browser_download_url: 'https://example.test/x.zip',
          size: 20,
          digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        }],
      }]), { status: 200 }),
      download: async () => {
        entered += 1
        if (entered === 1) await blocked
      },
      sha256File: async () => 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      extract: async () => {},
      listDir: async () => [{ name: 'dsh-web.exe', isDirectory: false }, { name: 'VERSION', isDirectory: false }],
      exit: (code) => { exits.push(code) },
      statfs: async () => ({ bavail: 1_000_000, bsize: 4096 }),
    }))
    await handler(DESKTOP_UPDATE_PATHS.check)(
      new Request('http://127.0.0.1/api/desktop-update/check', { method: 'POST' }),
    )
    const first = handler(DESKTOP_UPDATE_PATHS.download)(
      new Request('http://127.0.0.1/api/desktop-update/download', { method: 'POST' }),
    )
    await vi.waitFor(() => { expect(entered).toBe(1) })
    const conflict = await handler(DESKTOP_UPDATE_PATHS.download)(
      new Request('http://127.0.0.1/api/desktop-update/download', { method: 'POST' }),
    )
    expect(conflict.status).toBe(409)
    resume()
    await first
    await ctx.fiber.dispose()
    expect(exits).toEqual([])
  })

  it('exits after a successful apply', async () => {
    const exits: number[] = []
    const ctx = ctxWithConnection()
    mountDesktopUpdate(ctx, resolveConfig({ checkOnBoot: false }), testIo({
      exists: path => path.endsWith('VERSION') || path.endsWith('dsh-web.exe'),
      readFile: () => '0.1.2-alpha.5.winexe.17\n',
      fetch: async () => new Response(JSON.stringify([zipAsset()]), { status: 200 }),
      download: async () => {},
      sha256File: async () => 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      extract: async () => {},
      listDir: async () => [{ name: 'dsh-web.exe', isDirectory: false }, { name: 'VERSION', isDirectory: false }],
      statfs: async () => ({ bavail: 1_000_000, bsize: 4096 }),
      spawnHelper: () => {},
      exit: (code) => { exits.push(code) },
    }))
    await handler(DESKTOP_UPDATE_PATHS.check)(
      new Request('http://127.0.0.1/api/desktop-update/check', { method: 'POST' }),
    )
    await handler(DESKTOP_UPDATE_PATHS.download)(
      new Request('http://127.0.0.1/api/desktop-update/download', { method: 'POST' }),
    )
    await handler(DESKTOP_UPDATE_PATHS.apply)(
      new Request('http://127.0.0.1/api/desktop-update/apply', { method: 'POST' }),
    )
    await new Promise<void>((resolve) => { queueMicrotask(resolve) })
    expect(exits).toEqual([0])
    await ctx.fiber.dispose()
  })

  it('probes GitHub on boot when packaged', async () => {
    const ctx = ctxWithConnection()
    mountDesktopUpdate(ctx, resolveConfig({ checkOnBoot: true }), testIo())
    await Promise.resolve()
    await ctx.fiber.dispose()
  })

  it('swallows a boot check aborted by dispose', async () => {
    const ctx = ctxWithConnection()
    mountDesktopUpdate(ctx, resolveConfig({ checkOnBoot: true }), testIo({
      fetch: async (_url, init) => {
        await new Promise<void>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => { reject(new Error('aborted')) })
        })
        return new Response('[]', { status: 200 })
      },
    }))
    await ctx.fiber.dispose()
  })

  it('apply() mounts as unavailable on a source Node host', async () => {
    const ctx = ctxWithConnection()
    apply(ctx, { checkOnBoot: false })
    const status = await handler(DESKTOP_UPDATE_PATHS.status)(
      new Request('http://127.0.0.1/api/desktop-update/status'),
    )
    expect(await status.json()).toMatchObject({ mode: 'unavailable' })
    await ctx.fiber.dispose()
  })
})

describe('createDefaultIo', () => {
  const dirs: string[] = []
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  })

  it('reads and hashes real files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-desktop-update-'))
    dirs.push(dir)
    const path = join(dir, 'VERSION')
    await writeFile(path, '1.0.0\n')
    const io = createDefaultIo()
    expect(io.exists(path)).toBe(true)
    expect(io.readFile(path)).toBe('1.0.0\n')
    expect(io.readFile(join(dir, 'missing'))).toBeUndefined()
    expect(io.now()).toBeTypeOf('number')
    expect(io.pid).toBe(process.pid)
    const nested = join(dir, 'a', 'b.txt')
    await io.writeFile(nested, 'hello')
    expect(await io.sha256File(nested)).toHaveLength(64)
    await io.mkdir(join(dir, 'sub'))
    expect(await io.listDir(dir)).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'VERSION', isDirectory: false }),
    ]))
    const space = await io.statfs(dir)
    expect(space.bsize).toBeGreaterThan(0)
    await io.rm(join(dir, 'sub'))
    expect(io.resolveHome()).toContain('dsh')
  })
})
