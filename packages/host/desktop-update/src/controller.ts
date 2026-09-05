/**
 * Packaged-desktop updater state machine. Side effects go through
 * {@link DesktopUpdateIo} so unit tests never touch the network, disk, or
 * `process.exit`.
 */

import { join } from 'node:path'
import type { DesktopUpdateProgress, DesktopUpdateStatus, SelectedRelease } from './types.ts'
import { digestMismatch, parseSha256Digest } from './digest.ts'
import { applyHelperScript } from './helper.ts'
import { isOutdated, parseGitHubReleases, pickNewestZip } from './releases.ts'
import {
  APPLY_SCRIPT_NAME, DOWNLOAD_ZIP_NAME, EXTRACT_DIR_NAME, WORK_DIR_NAME,
} from './paths.ts'
import {
  detectPackagedProduct, isPackagedExtract, PRODUCT_LAUNCHERS, type PackagedProduct,
} from './product.ts'

/** Extra bytes reserved beyond twice the zip size for extract scratch. */
const DISK_HEADROOM_BYTES = 64 * 1024 * 1024

/** User-Agent GitHub requires of API clients. */
export const GITHUB_USER_AGENT = 'dsh-desktop-update'

/** Resolved updater configuration. */
export interface DesktopUpdateResolvedConfig {
  /** `owner/name` GitHub repository. */
  readonly repository: string
  /** Required zip asset filename prefix. */
  readonly assetPrefix: string
  /** Cache window for GitHub list responses, in milliseconds. */
  readonly cacheTtlMs: number
}

/** Filesystem listing used to peel a single wrapping zip directory. */
export interface DirectoryEntry {
  /** Basename. */
  readonly name: string
  /** True when the entry is a directory. */
  readonly isDirectory: boolean
}

/**
 * Basename of a single wrapping directory inside an extract tree.
 * @param entries - extract-directory children.
 * @returns the wrapper basename, or `undefined` when the tree is already flat.
 */
export function peelExtractRootName(entries: readonly DirectoryEntry[]): string | undefined {
  const real = entries.filter(entry => entry.name !== '.' && entry.name !== '..')
  if (real.length === 1 && real[0]?.isDirectory === true) return real[0].name
  return undefined
}

/** Replaceable host effects. */
export interface DesktopUpdateIo {
  /** `process.execPath`. */
  readonly execPath: string
  /** `process.pid`. */
  readonly pid: number
  /** `process.platform`. */
  readonly platform: NodeJS.Platform
  /** Current epoch ms. */
  now(): number
  /** Path existence. */
  exists(path: string): boolean
  /** Read a UTF-8 file; `undefined` when missing or unreadable. */
  readFile(path: string): string | undefined
  /** Write a UTF-8 file, creating parents. */
  writeFile(path: string, contents: string): Promise<void>
  /** Create a directory recursively. */
  mkdir(path: string): Promise<void>
  /** Remove a path recursively. */
  rm(path: string): Promise<void>
  /** List a directory with file/directory kinds. */
  listDir(path: string): Promise<readonly DirectoryEntry[]>
  /** Free-space probe; `bavail * bsize` is available bytes. */
  statfs(path: string): Promise<{ bavail: number; bsize: number }>
  /** HTTP fetch (GitHub API). */
  fetch(url: string, init?: RequestInit): Promise<Response>
  /** SHA-256 hex of a file. */
  sha256File(path: string): Promise<string>
  /**
   * Download a URL to a file, reporting byte progress.
   * @param url - source URL.
   * @param dest - destination path.
   * @param onProgress - received/total callback.
   * @param signal - cancellation.
   */
  download(
    url: string,
    dest: string,
    onProgress: (received: number, total: number) => void,
    signal: AbortSignal,
  ): Promise<void>
  /** Extract a zip into an empty directory. */
  extract(zipPath: string, destDir: string): Promise<void>
  /** Start the detached apply helper at `scriptPath`. */
  spawnHelper(scriptPath: string): void
  /** Exit this process after the apply response is committed. */
  exit(code: number): void
  /** `$DSH_HOME`. */
  resolveHome(): string
  /** `process.cwd()`; packaged web may chdir to the exe directory. */
  cwd(): string
}

/**
 * Host updater. One instance per plugin fiber.
 */
export class DesktopUpdateController {
  private mode: DesktopUpdateStatus['mode']
  private readonly product: PackagedProduct | undefined
  private latest: SelectedRelease | undefined
  private error: string | undefined
  private progress: DesktopUpdateProgress | undefined
  private checkedAt = 0
  private downloadLock = false

  /**
   * @param config - resolved plugin config.
   * @param io - host effects.
   */
  constructor(
    private readonly config: DesktopUpdateResolvedConfig,
    private readonly io: DesktopUpdateIo,
  ) {
    this.product = detectPackagedProduct(
      io.execPath,
      path => io.exists(path),
      path => io.readFile(path),
      [io.cwd()],
    )
    this.mode = this.product === undefined ? 'unavailable' : 'idle'
  }

  /**
   * Point-in-time snapshot for the browser.
   * @returns JSON status.
   */
  snapshot(): DesktopUpdateStatus {
    const current = this.product?.version
    const latest = this.latest?.version
    return {
      mode: this.mode,
      ...(current === undefined ? {} : { current }),
      ...(latest === undefined ? {} : { latest }),
      outdated: current !== undefined && latest !== undefined && isOutdated(current, latest),
      ...(this.latest?.notes === undefined ? {} : { notes: this.latest.notes }),
      ...(this.error === undefined ? {} : { error: this.error }),
      ...(this.progress === undefined ? {} : { progress: this.progress }),
      ...(this.latest === undefined ? {} : { assetName: this.latest.assetName }),
    }
  }

  /**
   * Probe GitHub Releases and remember the newest matching zip.
   * @param force - skip the cache window.
   * @param signal - cancellation.
   * @returns the updated snapshot.
   */
  async check(force: boolean, signal: AbortSignal): Promise<DesktopUpdateStatus> {
    if (this.product === undefined) return this.snapshot()
    if (!force && this.latest !== undefined && this.io.now() - this.checkedAt < this.config.cacheTtlMs) {
      return this.snapshot()
    }
    try {
      const url = `https://api.github.com/repos/${this.config.repository}/releases?per_page=30`
      const response = await this.io.fetch(url, {
        signal,
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': GITHUB_USER_AGENT,
          'X-GitHub-Api-Version': '2022-11-28',
        },
      })
      if (!response.ok) {
        throw new Error(`GitHub releases HTTP ${String(response.status)}`)
      }
      const releases = parseGitHubReleases(await response.json())
      this.latest = pickNewestZip(releases, this.config.assetPrefix)
      this.checkedAt = this.io.now()
      if (this.mode === 'error') this.mode = 'idle'
      this.error = undefined
    } catch (error) {
      if (signal.aborted) throw error
      this.error = messageOf(error)
      if (this.mode === 'idle' || this.mode === 'unavailable') this.mode = 'error'
    }
    return this.snapshot()
  }

  /**
   * Download and extract the newest zip when it is newer than VERSION.
   * @param signal - cancellation.
   * @returns the updated snapshot.
   */
  async download(signal: AbortSignal): Promise<DesktopUpdateStatus> {
    if (this.product === undefined) {
      return this.fail('not a packaged desktop')
    }
    if (this.mode === 'downloading' || this.downloadLock) {
      return this.fail('download already in progress')
    }
    this.downloadLock = true
    try {
      if (this.latest === undefined) await this.check(true, signal)
      const selected = this.latest
      const current = this.product.version
      if (selected === undefined || !isOutdated(current, selected.version)) {
        return this.fail('no newer packaged zip')
      }
      if (parseSha256Digest(selected.digest) === undefined) {
        return this.fail('GitHub asset digest is missing or not sha256')
      }
      await this.runDownload(selected, signal)
      return this.snapshot()
    } finally {
      this.downloadLock = false
    }
  }

  /**
   * Write the apply helper. Callers must send the HTTP response before
   * `io.exit` runs.
   * @returns the applying snapshot, or an error snapshot.
   */
  async armApply(): Promise<DesktopUpdateStatus> {
    if (this.product === undefined) return this.fail('not a packaged desktop')
    if (this.mode !== 'ready') return this.fail('download a zip before applying')
    if (this.io.platform !== 'win32') return this.fail('apply is implemented only on Windows')
    const extractDir = this.extractRoot()
    if (extractDir === undefined || !isPackagedExtract(extractDir, path => this.io.exists(path))) {
      return this.fail('extracted zip is not a packaged desktop')
    }
    const exeName = PRODUCT_LAUNCHERS.find(name => this.io.exists(join(extractDir, name)))
    /* v8 ignore next -- isPackagedExtract already required a launcher */
    if (exeName === undefined) return this.fail('extracted zip is missing a launcher')
    const workDir = this.workDir()
    const scriptPath = join(workDir, APPLY_SCRIPT_NAME)
    const exePath = join(this.product.productDir, exeName)
    const script = applyHelperScript({
      parentPid: this.io.pid,
      extractDir,
      productDir: this.product.productDir,
      exePath,
    })
    try {
      await this.io.writeFile(scriptPath, script)
      this.io.spawnHelper(scriptPath)
    } catch (error) {
      return this.fail(messageOf(error))
    }
    this.mode = 'applying'
    this.error = undefined
    return this.snapshot()
  }

  /**
   * Work directory under `$DSH_HOME`.
   * @returns `$DSH_HOME/desktop-update`.
   */
  workDir(): string {
    return join(this.io.resolveHome(), WORK_DIR_NAME)
  }

  /** Remembered extract root after a successful download, when present. */
  private extractRootPath: string | undefined

  private extractRoot(): string | undefined {
    return this.extractRootPath
  }

  private fail(error: string): DesktopUpdateStatus {
    this.error = error
    if (this.mode !== 'downloading' && this.mode !== 'applying') this.mode = 'error'
    return this.snapshot()
  }

  private async runDownload(selected: SelectedRelease, signal: AbortSignal): Promise<void> {
    this.mode = 'downloading'
    this.error = undefined
    this.progress = { received: 0, total: selected.size }
    const workDir = this.workDir()
    const zipPath = join(workDir, DOWNLOAD_ZIP_NAME)
    const extractDir = join(workDir, EXTRACT_DIR_NAME)
    try {
      await this.io.mkdir(workDir)
      await this.ensureDisk(workDir, selected.size)
      await this.io.download(
        selected.downloadUrl,
        zipPath,
        (received, total) => { this.progress = { received, total } },
        signal,
      )
      const actual = await this.io.sha256File(zipPath)
      const mismatch = digestMismatch(actual, selected.digest)
      if (mismatch !== undefined) throw new Error(mismatch)
      await this.io.rm(extractDir)
      await this.io.mkdir(extractDir)
      await this.io.extract(zipPath, extractDir)
      const wrapper = peelExtractRootName(await this.io.listDir(extractDir))
      const root = wrapper === undefined ? extractDir : join(extractDir, wrapper)
      if (!isPackagedExtract(root, path => this.io.exists(path))) {
        throw new Error('extracted zip is not a packaged desktop')
      }
      this.extractRootPath = root
      this.mode = 'ready'
      this.progress = undefined
    } catch (error) {
      if (signal.aborted) {
        this.mode = 'idle'
        this.progress = undefined
        throw error
      }
      this.mode = 'error'
      this.progress = undefined
      this.error = messageOf(error)
    }
  }

  private async ensureDisk(path: string, zipSize: number): Promise<void> {
    const { bavail, bsize } = await this.io.statfs(path)
    const free = bavail * bsize
    const needed = zipSize * 2 + DISK_HEADROOM_BYTES
    if (free < needed) {
      throw new Error(`need ${String(needed)} bytes free, have ${String(free)}`)
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
