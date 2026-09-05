/**
 * Host plugin: check GitHub Releases for a newer packaged Windows zip, download
 * it onto `$DSH_HOME/desktop-update`, and arm a helper that replaces the
 * product folder after this process exits. `.config` is never copied.
 */

import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import {
  createReadStream, createWriteStream, existsSync, readFileSync,
} from 'node:fs'
import { mkdir, readdir, rm, statfs, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  DesktopUpdateController, type DesktopUpdateIo, type DesktopUpdateResolvedConfig,
} from './controller.ts'
import { isLoopbackRequest } from './loopback.ts'
import { DESKTOP_UPDATE_PATHS } from './paths.ts'

export type {
  DesktopUpdateMode, DesktopUpdateProgress, DesktopUpdateStatus, GitHubRelease,
  GitHubReleaseAsset, SelectedRelease, WinexeVersion,
} from './types.ts'
export {
  compareSemver, compareWinexeVersion, parseSemver, parseWinexeVersion,
} from './version.ts'
export {
  isOutdated, parseGitHubReleases, pickNewestZip, versionFromAssetName,
} from './releases.ts'
export {
  CONFIG_DIRNAME, detectPackagedProduct, isPackagedExtract, PRODUCT_LAUNCHERS,
  readProductVersion, shouldCopyProductEntry, VERSION_FILENAME,
} from './product.ts'
export { digestMismatch, parseSha256Digest } from './digest.ts'
export { applyHelperScript, powershellLiteral } from './helper.ts'
export { isLoopbackHostname, isLoopbackRequest } from './loopback.ts'
export { DESKTOP_UPDATE_PATHS } from './paths.ts'
export {
  DesktopUpdateController, GITHUB_USER_AGENT, peelExtractRootName,
} from './controller.ts'
export type { DesktopUpdateIo, DesktopUpdateResolvedConfig, DirectoryEntry } from './controller.ts'

/** Cordis function-plugin name. */
export const name = 'desktop-update'

/** Host services required before Fetch routes can register. */
export const inject = ['connection']

/** Default GitHub repository that publishes winexe zips. */
export const DEFAULT_REPOSITORY = 'lihongxu0221/deepseek-harness'

/** Default zip asset filename prefix. */
export const DEFAULT_ASSET_PREFIX = 'dsh-web-win-x64-'

/** Default GitHub list cache window. */
export const DEFAULT_CACHE_TTL_MS = 10 * 60_000

/** `owner/name` with no extra slashes. */
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u

/** Plugin configuration. */
export interface Config {
  /** GitHub `owner/name` that publishes winexe zips. @default lihongxu0221/deepseek-harness */
  readonly repository?: string
  /** Required zip asset filename prefix. @default dsh-web-win-x64- */
  readonly assetPrefix?: string
  /** Probe GitHub after load when this is a packaged desktop. @default true */
  readonly checkOnBoot?: boolean
  /** GitHub list cache window in milliseconds. @default 600000 */
  readonly cacheTtlMs?: number
}

export const Config: z<Config> = z.object({
  repository: z.string().default(DEFAULT_REPOSITORY),
  assetPrefix: z.string().default(DEFAULT_ASSET_PREFIX),
  checkOnBoot: z.boolean().default(true),
  cacheTtlMs: z.number().step(1).min(0).default(DEFAULT_CACHE_TTL_MS),
})

interface ConnectionFetch {
  readonly fetch: {
    register(route: {
      readonly path: string
      readonly methods: readonly ('GET' | 'HEAD' | 'POST')[]
      readonly requestBody: 'buffered'
      readonly fetch: (request: Request) => Promise<Response>
    }): () => Promise<void>
  }
}

/**
 * Mount the updater on a Host context.
 * @param ctx - Host context carrying `connection`.
 * @param config - resolved plugin config (schema defaults applied).
 */
export function apply(ctx: Context, config: Config = {}): void {
  mountDesktopUpdate(ctx, resolveConfig(config), createDefaultIo())
}

/**
 * Resolve and validate plugin config.
 * @param config - raw config.
 * @returns defaults applied.
 */
export function resolveConfig(config: Config): DesktopUpdateResolvedConfig & { checkOnBoot: boolean } {
  const repository = (config.repository ?? DEFAULT_REPOSITORY).trim()
  const assetPrefix = (config.assetPrefix ?? DEFAULT_ASSET_PREFIX).trim()
  if (!REPOSITORY.test(repository)) {
    throw new Error(`desktop-update repository ${JSON.stringify(repository)} must be owner/name`)
  }
  if (assetPrefix === '' || assetPrefix.includes('/') || assetPrefix.includes('\\')) {
    throw new Error(`desktop-update assetPrefix ${JSON.stringify(assetPrefix)} must be a filename prefix`)
  }
  return {
    repository,
    assetPrefix,
    cacheTtlMs: config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
    checkOnBoot: config.checkOnBoot ?? true,
  }
}

/**
 * Register routes and optional boot check. Tests pass a fake {@link DesktopUpdateIo}.
 * @param ctx - Host context.
 * @param config - resolved config including checkOnBoot.
 * @param io - host effects.
 * @returns the controller.
 */
export function mountDesktopUpdate(
  ctx: Context,
  config: DesktopUpdateResolvedConfig & { checkOnBoot: boolean },
  io: DesktopUpdateIo,
): DesktopUpdateController {
  const controller = new DesktopUpdateController(config, io)
  const abort = new AbortController()
  const connection = ctx.get('connection') as ConnectionFetch | undefined
  if (connection === undefined) {
    throw new Error('desktop-update: connection service is missing')
  }
  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })
  const fence = (request: Request, run: () => Promise<Response>): Promise<Response> => {
    if (!isLoopbackRequest(request)) return Promise.resolve(json(403, { ok: false, code: 'forbidden' }))
    return run()
  }
  const routes = [
    connection.fetch.register({
      path: DESKTOP_UPDATE_PATHS.status,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: request => fence(request, () => Promise.resolve(json(200, controller.snapshot()))),
    }),
    connection.fetch.register({
      path: DESKTOP_UPDATE_PATHS.progress,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: request => fence(request, () => Promise.resolve(json(200, controller.snapshot()))),
    }),
    connection.fetch.register({
      path: DESKTOP_UPDATE_PATHS.check,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: request => fence(request, () => controller.check(true, request.signal).then(body => json(200, body))),
    }),
    connection.fetch.register({
      path: DESKTOP_UPDATE_PATHS.download,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: request => fence(request, () => controller.download(request.signal).then((body) => {
        const status = body.error === 'download already in progress' ? 409 : 200
        return json(status, body)
      })),
    }),
    connection.fetch.register({
      path: DESKTOP_UPDATE_PATHS.apply,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: request => fence(request, async () => {
        const body = await controller.armApply()
        if (body.mode === 'applying') queueMicrotask(() => { io.exit(0) })
        return json(200, body)
      }),
    }),
  ]
  ctx.effect(() => async () => {
    abort.abort()
    for (const dispose of routes) await dispose()
  }, 'desktop-update: routes')
  if (config.checkOnBoot && controller.snapshot().mode !== 'unavailable') {
    void controller.check(false, abort.signal).catch(() => {
      // Boot probe failures stay on the snapshot; they must not fail plugin load.
    })
  }
  return controller
}

/**
 * Production host effects. Tests replace this object.
 * @returns the default I/O adapter.
 */
export function createDefaultIo(): DesktopUpdateIo {
  return {
    execPath: process.execPath,
    pid: process.pid,
    platform: process.platform,
    cwd: () => process.cwd(),
    now: () => Date.now(),
    exists: path => existsSync(path),
    readFile: (path) => {
      try {
        return readFileSync(path, 'utf8')
      } catch {
        return undefined
      }
    },
    writeFile: async (path, contents) => {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, contents, 'utf8')
    },
    mkdir: path => mkdir(path, { recursive: true }).then(() => undefined),
    rm: path => rm(path, { recursive: true, force: true }),
    listDir: async (path) => {
      const entries = await readdir(path, { withFileTypes: true })
      return entries.map(entry => ({ name: entry.name, isDirectory: entry.isDirectory() }))
    },
    statfs: async (path) => {
      const info = await statfs(path)
      return { bavail: Number(info.bavail), bsize: Number(info.bsize) }
    },
    fetch,
    sha256File: async (path) => {
      const hash = createHash('sha256')
      for await (const chunk of createReadStream(path)) hash.update(chunk)
      return hash.digest('hex')
    },
    /* v8 ignore start -- production download/extract/spawn/exit; controller tests replace Io */
    download: async (url, dest, onProgress, signal) => {
      const response = await fetch(url, { signal, redirect: 'follow' })
      if (!response.ok) throw new Error(`download HTTP ${String(response.status)}`)
      const lengthHeader = response.headers.get('content-length')
      const total = lengthHeader === null ? 0 : Number(lengthHeader)
      if (response.body === null) throw new Error('download response has no body')
      await mkdir(dirname(dest), { recursive: true })
      let received = 0
      const counter = new Transform({
        transform(chunk, _encoding, callback) {
          received += chunk.length
          onProgress(received, total === 0 ? received : total)
          callback(null, chunk)
        },
      })
      await pipeline(
        Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
        counter,
        createWriteStream(dest),
      )
    },
    extract: (zipPath, destDir) => new Promise((resolve, reject) => {
      const child = spawn('tar', ['-xf', zipPath, '-C', destDir], { windowsHide: true })
      child.once('error', reject)
      child.once('exit', (code) => {
        if (code === 0) {
          resolve()
          return
        }
        reject(new Error(`tar extract failed with exit code ${String(code)}`))
      })
    }),
    spawnHelper: (scriptPath) => {
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
        { detached: true, stdio: 'ignore', windowsHide: true },
      )
      child.unref()
    },
    exit: (code) => { process.exit(code) },
    /* v8 ignore stop */
    resolveHome: () => resolveDshHome(),
  }
}
