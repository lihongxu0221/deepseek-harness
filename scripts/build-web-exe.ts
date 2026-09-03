/**
 * Build the packaged Web desktop product. The CLI production closure is
 * deployed to an on-disk folder; a thin CommonJS `@yao-pkg/pkg --sea` launcher beside
 * that tree imports `lib/packaged-web-bin.js`. Profile module fallback needs
 * real packages, so this is not a single-file snapshot of the Web GUI.
 * This product is not the JSON-RPC agent and is not copied into the Python runtime.
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { copyFile, cp, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { seedBuiltinProfilePlugins } from './build-builtin-profile-plugins.ts'
import { resolvePackagedWebExeVersion } from './packaged-web-exe-version.ts'
import { withPreservedPackagedWebHome } from './preserve-packaged-web-home.ts'
import { setWindowsPeSubsystem } from './windows-pe-subsystem.ts'

const root = resolve(import.meta.dirname, '..')

/** The CLI package whose production closure is the desktop product. */
const DEPLOY_ROOT_PACKAGE = '@deepseek-ai/dsh'
/** Packaged Web desktop entry inside the deployed CLI package. */
const ENTRY_BIN = 'lib/packaged-web-bin.js'
/** Thin pkg launcher built from the workspace CLI package, not from the deploy tree. */
/** Thin pkg launcher. Must be CommonJS; Node SEA embeds it via embedderRunCjs. */
const LAUNCHER_BIN = join(root, 'apps', 'cli', 'packaged-web-launcher.cjs')
/** Stopped (black) whale `.ico`; copied beside the Windows launcher. */
const DESKTOP_ICON = join(root, 'apps', 'cli', 'assets', 'dsh-web.ico')
/** Running (DeepSeek 500 blue) whale `.ico`. */
const DESKTOP_RUNNING_ICON = join(root, 'apps', 'cli', 'assets', 'dsh-web-running.ico')
const OUTPUT_BASENAME = 'dsh-web'
const LAUNCHER_NAME = 'dsh-web'
/** Default Node major; SEA mode requires at least Node 22. */
const DEFAULT_NODE_RANGE = 'node24'
/** Pinned for reproducible builds. */
const PKG_SPEC = '@yao-pkg/pkg@6.21.0'
const OUT_DIR = 'dist-exe'
const SHARED_STAGING_DIR = join(OUT_DIR, 'web-staging')
const FRONTEND_DIST_INDEX = join('node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'index.html')

const PLATFORMS = ['linux', 'macos', 'win'] as const
const ARCHES = ['x64', 'arm64'] as const
type Platform = (typeof PLATFORMS)[number]
type Arch = (typeof ARCHES)[number]

function isPlatform(value: string): value is Platform {
  return (PLATFORMS as readonly string[]).includes(value)
}

function isArch(value: string): value is Arch {
  return (ARCHES as readonly string[]).includes(value)
}

/**
 * A parsed pkg target triple, constructed from `--targets` or the host.
 */
class Target {
  private constructor(
    /** pkg Node range (`node<major>`). */
    readonly nodeRange: string,
    /** pkg platform tag. */
    readonly platform: Platform,
    /** pkg CPU tag. */
    readonly arch: Arch,
  ) {}

  /** The pkg `--targets` spec string `<nodeRange>-<platform>-<arch>`. */
  get spec(): string {
    return `${this.nodeRange}-${this.platform}-${this.arch}`
  }

  /**
   * Parse one target spec, rejecting malformed triples and unsupported platform or architecture.
   * @param spec - the raw triple, e.g. `node24-win-x64`.
   * @returns the parsed target.
   */
  static parse(spec: string): Target {
    const parts = spec.split('-')
    const [nodeRange, platform, arch] = parts
    if (parts.length !== 3 || nodeRange === undefined || platform === undefined || arch === undefined) {
      throw new Error(`build-web-exe: target ${JSON.stringify(spec)} must be <nodeRange>-<platform>-<arch>, e.g. node24-win-x64.`)
    }
    if (!/^node\d+$/.test(nodeRange)) {
      throw new Error(`build-web-exe: target ${JSON.stringify(spec)}: node range must look like node24, got ${JSON.stringify(nodeRange)}.`)
    }
    if (!isPlatform(platform)) {
      throw new Error(`build-web-exe: target ${JSON.stringify(spec)}: platform must be one of ${PLATFORMS.join(', ')}, got ${JSON.stringify(platform)}.`)
    }
    if (!isArch(arch)) {
      throw new Error(`build-web-exe: target ${JSON.stringify(spec)}: arch must be one of ${ARCHES.join(', ')}, got ${JSON.stringify(arch)}.`)
    }
    return new Target(nodeRange, platform, arch)
  }

  /**
   * Resolve the host-platform default on Node 24.
   * @returns the host target; throws on an unsupported host platform or arch.
   */
  static host(): Target {
    const platform = process.platform === 'darwin'
      ? 'macos'
      : process.platform === 'linux'
        ? 'linux'
        : process.platform === 'win32'
          ? 'win'
          : undefined
    if (platform === undefined) {
      throw new Error(`build-web-exe: unsupported host platform ${process.platform}; pass --targets explicitly.`)
    }
    const arch = process.arch === 'x64' || process.arch === 'arm64' ? process.arch : undefined
    if (arch === undefined) {
      throw new Error(`build-web-exe: unsupported host arch ${process.arch}; pass --targets explicitly.`)
    }
    return new Target(DEFAULT_NODE_RANGE, platform, arch)
  }
}

/**
 * Validated CLI configuration; construction owns help and parse-error exits.
 */
class BuildCli {
  private constructor(
    /** Build targets; defaults to the host platform only. */
    readonly targets: readonly Target[],
    /** Skip `pnpm run build` when lib artifacts already exist. */
    readonly skipBuild: boolean,
    /** Print planned work without writing. */
    readonly dryRun: boolean,
    /** Restore missing staged packages without clearing the product folder. */
    readonly restoreOnly: boolean,
    /** Product-folder VERSION stamp; defaults to the root package.json version. */
    readonly productVersion: string,
    /**
     * Folder name under dist-exe. Defaults to `dsh-web-<platform>-<arch>`.
     * A custom name is only valid for a single target.
     */
    readonly productDir: string | undefined,
  ) {}

  /**
   * Parse argv; `--help` prints usage and exits 0.
   * @param argv - arguments after the script name.
   * @returns the validated configuration.
   */
  static parse(argv: string[]): BuildCli {
    const values = BuildCli.parseRaw(argv)
    if (values.help) {
      console.log(BuildCli.usage())
      process.exit(0)
    }
    const targets = values.targets === undefined
      ? [Target.host()]
      : values.targets.split(',').map(part => part.trim()).filter(part => part !== '').map(spec => Target.parse(spec))
    if (targets.length === 0) throw new Error('build-web-exe: --targets is empty.')
    const seen = new Set<string>()
    for (const target of targets) {
      const key = `${target.platform}-${target.arch}`
      if (seen.has(key)) {
        throw new Error(`build-web-exe: duplicate platform-arch ${key} in --targets; canonical product names would collide.`)
      }
      seen.add(key)
    }
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: string }
    const baseVersion = typeof manifest.version === 'string' ? manifest.version : ''
    const productVersion = resolvePackagedWebExeVersion(baseVersion, process.env, values['product-version'])
    const productDir = values['product-dir']
    if (productDir !== undefined) {
      if (targets.length !== 1) {
        throw new Error('build-web-exe: --product-dir requires exactly one --targets entry.')
      }
      if (!/^[A-Za-z0-9._-]+$/.test(productDir)) {
        throw new Error('build-web-exe: --product-dir must be a single folder name under dist-exe.')
      }
    }
    return new BuildCli(
      targets, values['skip-build'], values['dry-run'], values['restore-only'], productVersion, productDir,
    )
  }

  private static parseRaw(argv: string[]) {
    return parseArgs({
      args: argv,
      options: {
        'targets': { type: 'string' },
        'skip-build': { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        'restore-only': { type: 'boolean', default: false },
        'product-version': { type: 'string' },
        'product-dir': { type: 'string' },
        'help': { type: 'boolean', default: false },
      },
    }).values
  }

  private static usage(): string {
    return [
      'Usage: pnpm exec tsx scripts/build-web-exe.ts [flags]',
      '',
      '  --targets=<t1,t2,...>  pkg targets, e.g. node24-win-x64.',
      '                         Default: the host platform only (on node24).',
      '  --skip-build           skip `pnpm run build` (lib/ artifacts must already exist).',
      '  --dry-run              print every command and config patch without executing.',
      '  --restore-only         copy missing staged packages; do not rebuild or wipe.',
      '  --product-version=<v>  stamp VERSION / README; default: package.json or DSH_WEB_EXE_*.',
      '  --product-dir=<name>   folder under dist-exe; default: dsh-web-<platform>-<arch>.',
      '  --help                 print this help.',
      '',
      `Build route: deploy the CLI closure, then ${PKG_SPEC} --sea for a thin launcher.`,
      `Writes ${OUTPUT_BASENAME}-<platform>-<arch>/ to ${OUT_DIR}/.`,
      'This is the double-click Web GUI, not the JSON-RPC Python runtime exe.',
    ].join('\n')
  }
}

function pnpmBin(): string {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

/**
 * Render a command for logs and errors, quoting arguments with spaces.
 * @param command - the executable.
 * @param args - its arguments.
 * @returns the printable command line.
 */
function formatCommand(command: string, args: string[]): string {
  return [command, ...args].map(part => (part.includes(' ') ? JSON.stringify(part) : part)).join(' ')
}

function productDirName(target: Target, override?: string): string {
  return override ?? `${OUTPUT_BASENAME}-${target.platform}-${target.arch}`
}

/** Workspace package name to source directory, excluding nested node_modules. */
async function indexWorkspacePackages(): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const roots = [
    join(root, 'vendor'),
    join(root, 'packages'),
    join(root, 'apps'),
    join(root, 'native', 'landlock-run'),
  ]
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > 4 || !existsSync(directory)) return
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'lib') continue
      if (!entry.isDirectory()) continue
      const path = join(directory, entry.name)
      const manifestPath = join(path, 'package.json')
      if (existsSync(manifestPath)) {
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { name?: string }
        if (typeof manifest.name === 'string' && manifest.name !== '' && !map.has(manifest.name)) {
          map.set(manifest.name, path)
        }
      }
      await visit(path, depth + 1)
    }
  }
  for (const workspaceRoot of roots) await visit(workspaceRoot, 0)
  return map
}

/** Regular and peer dependencies of the staged root and its top-level node_modules packages. */
async function collectMissingStagedDependencies(staging: string): Promise<string[]> {
  const manifests = [join(staging, 'package.json')]
  const nodeModules = join(staging, 'node_modules')
  if (existsSync(nodeModules)) {
    for (const entry of await readdir(nodeModules, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || !entry.isDirectory()) continue
      const path = join(nodeModules, entry.name)
      if (entry.name.startsWith('@')) {
        for (const scoped of await readdir(path, { withFileTypes: true })) {
          if (!scoped.isDirectory()) continue
          manifests.push(join(path, scoped.name, 'package.json'))
        }
      } else {
        manifests.push(join(path, 'package.json'))
      }
    }
  }
  const missing = new Set<string>()
  for (const manifestPath of manifests) {
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      dependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
    }
    for (const dependency of [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ]) {
      if (!existsSync(join(staging, 'node_modules', dependency))) missing.add(dependency)
    }
  }
  return [...missing].sort()
}

/**
 * Sequential build pipeline. Subprocesses inherit stdio and errors include
 * the command; dry runs print commands and filesystem changes.
 */
class WebExeBuild {
  readonly staging: string
  private readonly outDir = resolve(root, OUT_DIR)

  constructor(private readonly cli: BuildCli) {
    const [onlyTarget] = cli.targets
    this.staging = onlyTarget !== undefined && cli.targets.length === 1
      ? resolve(root, OUT_DIR, productDirName(onlyTarget, cli.productDir))
      : resolve(root, SHARED_STAGING_DIR)
  }

  /** Build all package artifacts unless `--skip-build` was passed. */
  async build(): Promise<void> {
    if (this.cli.skipBuild) {
      console.log('build-web-exe: skipping pnpm run build (--skip-build)')
      return
    }
    await this.run('build', pnpmBin(), ['run', 'build'])
  }

  /** Seed the deployed staging web profile with the builtin community plugins. */
  async seedBuiltinPlugins(): Promise<void> {
    await seedBuiltinProfilePlugins(this.staging, {
      dryRun: this.cli.dryRun,
      refresh: true,
      log: (line): void => {
        console.log(`build-web-exe: ${line}`)
      },
    })
  }


  /** Restore omitted packages in an already-deployed product folder. */
  async restoreExisting(): Promise<void> {
    if (!existsSync(this.staging)) {
      throw new Error(`build-web-exe: ${this.staging} is missing; there is no product to restore.`)
    }
    await this.restoreLegacyHoists()
    await this.materializeStagedLinks()
    await this.verifyStagedEntry()
  }

  /** Clear and deploy the CLI production closure. */
  async deployStaging(): Promise<void> {
    if (this.staging === root || root.startsWith(this.staging + sep)) {
      throw new Error(`build-web-exe: refusing to clear staging dir ${this.staging}: it contains the repo root.`)
    }
    const deploy = async (): Promise<void> => {
      if (this.cli.dryRun) console.log(`build-web-exe: [dry-run] rm -rf ${this.staging}`)
      else await rm(this.staging, { recursive: true, force: true })
      await this.run('deploy', pnpmBin(), [
        '--filter',
        DEPLOY_ROOT_PACKAGE,
        'deploy',
        '--legacy',
        '--prod',
        '--config.node-linker=hoisted',
        '--config.auto-install-peers=false',
        '--config.link-workspace-packages=true',
        this.staging,
      ])
      await this.restoreLegacyHoists()
      await this.materializeStagedLinks()
      await this.verifyStagedEntry()
    }
    if (this.cli.dryRun) await deploy()
    else await withPreservedPackagedWebHome(this.staging, deploy)
  }

  /**
   * Restore packages that pnpm's legacy hoister or `link:` workspace overrides
   * leave out of the deploy tree. Direct CLI dependencies are not enough:
   * `@deepseek-ai/cosmokit` and `@deepseek-ai/schemastery` are workspace
   * overrides, and Service Definition packages such as `dsh-fs` are peers.
   * Profile boot imports those packages from disk.
   */
  private async restoreLegacyHoists(): Promise<void> {
    if (this.cli.dryRun) {
      console.log('build-web-exe: [dry-run] restore dependencies omitted by legacy deploy')
      return
    }
    const workspace = await indexWorkspacePackages()
    const searchRoots = [
      resolve(root, 'apps/cli/node_modules'),
      resolve(root, 'node_modules'),
    ]
    const restored: string[] = []
    for (;;) {
      const missing = await collectMissingStagedDependencies(this.staging)
      let copied = 0
      for (const dependency of missing) {
        const destination = join(this.staging, 'node_modules', dependency)
        if (existsSync(destination)) continue
        const source = workspace.get(dependency)
          ?? searchRoots.map(dir => join(dir, dependency)).find(path => existsSync(path))
        if (source === undefined) continue
        await mkdir(dirname(destination), { recursive: true })
        const nestedNodeModules = join(source, 'node_modules')
        await cp(source, destination, {
          recursive: true,
          dereference: true,
          filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
        })
        restored.push(dependency)
        copied += 1
      }
      if (copied === 0) break
    }
    const stillMissing = (await collectMissingStagedDependencies(this.staging))
      .filter(dependency => dependency.startsWith('@deepseek-ai/'))
    if (stillMissing.length > 0) {
      throw new Error(`build-web-exe: staged workspace dependencies remain missing: ${stillMissing.join(', ')}.`)
    }
    if (restored.length > 0) {
      console.log(`build-web-exe: restored legacy deploy hoists: ${restored.join(', ')}`)
    }
  }

  /** Replace deploy-time package links with files and reject any remaining link. */
  private async materializeStagedLinks(): Promise<void> {
    if (this.cli.dryRun) {
      console.log('build-web-exe: [dry-run] materialize staged package links')
      return
    }
    const nodeModules = join(this.staging, 'node_modules')
    let remaining = await this.findSymlink(nodeModules)
    while (remaining !== undefined) {
      const segments = remaining.slice(nodeModules.length + 1).split(sep)
      const binIndex = segments.lastIndexOf('.bin')
      if (binIndex >= 0) {
        await rm(join(nodeModules, ...segments.slice(0, binIndex + 1)), { recursive: true, force: true })
        remaining = await this.findSymlink(nodeModules)
        continue
      }
      const destination = remaining
      const source = await realpath(destination)
      const nestedNodeModules = join(source, 'node_modules')
      await rm(destination, { recursive: true, force: true })
      await cp(source, destination, {
        recursive: true,
        dereference: true,
        filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
      })
      remaining = await this.findSymlink(nodeModules)
    }
  }

  /** Return the first symbolic link below a directory, if one exists. */
  private async findSymlink(directory: string): Promise<string | undefined> {
    if (!existsSync(directory)) return undefined
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const metadata = await lstat(path)
      if (metadata.isSymbolicLink()) return path
      if (metadata.isDirectory()) {
        const nested = await this.findSymlink(path)
        if (nested !== undefined) return nested
      }
    }
    return undefined
  }

  /** Confirm the deployed entry, launcher, and frontend dist exist. */
  private async verifyStagedEntry(): Promise<void> {
    if (this.cli.dryRun) {
      console.log(`build-web-exe: [dry-run] verify ${join(this.staging, ENTRY_BIN)} and ${LAUNCHER_BIN}`)
      return
    }
    const manifestPath = join(this.staging, 'package.json')
    if (!existsSync(manifestPath)) {
      throw new Error(`build-web-exe: ${manifestPath} missing — pnpm deploy did not produce a staged package.`)
    }
    if (!existsSync(join(this.staging, ENTRY_BIN))) {
      throw new Error(`build-web-exe: ${join(this.staging, ENTRY_BIN)} missing — run without --skip-build so lib/ artifacts exist.`)
    }
    if (!existsSync(LAUNCHER_BIN)) {
      throw new Error(`build-web-exe: ${LAUNCHER_BIN} missing — the CommonJS SEA launcher is a committed source file.`)
    }
    const frontend = join(this.staging, FRONTEND_DIST_INDEX)
    if (!existsSync(frontend)) {
      throw new Error(`build-web-exe: ${frontend} missing — run without --skip-build so the Web frontend dist exists.`)
    }
  }

  /**
   * Package one target: copy the deployed tree when needed, then wrap the
   * thin launcher. SEA mode accepts one target per invocation.
   * @param target - the pkg target triple to build.
   * @returns the product folder and executable paths.
   */
  async pack(target: Target): Promise<string[]> {
    const product = join(this.outDir, productDirName(target, this.cli.productDir))
    if (product !== this.staging) {
      if (this.cli.dryRun) console.log(`build-web-exe: [dry-run] cp ${this.staging} ${product}`)
      else {
        await withPreservedPackagedWebHome(product, async () => {
          await rm(product, { recursive: true, force: true })
          await mkdir(dirname(product), { recursive: true })
          await cp(this.staging, product, { recursive: true })
        })
      }
    }
    await this.prepareNativePty(product, target)
    const launcherOutput = join(product, LAUNCHER_NAME)
    await this.run(`pkg ${target.spec}`, pnpmBin(), [
      'dlx',
      PKG_SPEC,
      LAUNCHER_BIN,
      '--sea',
      '--targets',
      target.spec,
      '--output',
      launcherOutput,
    ])
    const windowsLauncher = `${launcherOutput}.exe`
    const launcher = !this.cli.dryRun && !existsSync(launcherOutput) && existsSync(windowsLauncher)
      ? windowsLauncher
      : launcherOutput
    if (!this.cli.dryRun && !existsSync(launcher)) {
      throw new Error(`build-web-exe: launcher ${launcher} is missing after the pkg run; inspect ${product}.`)
    }
    if (target.platform === 'win') {
      if (!existsSync(DESKTOP_ICON) || !existsSync(DESKTOP_RUNNING_ICON)) {
        throw new Error(`build-web-exe: missing Windows desktop icons ${DESKTOP_ICON} / ${DESKTOP_RUNNING_ICON}`)
      }
      const iconDest = join(product, 'dsh-web.ico')
      const runningDest = join(product, 'dsh-web-running.ico')
      if (this.cli.dryRun) {
        console.log(`build-web-exe: [dry-run] copy ${DESKTOP_ICON} ${iconDest}`)
        console.log(`build-web-exe: [dry-run] copy ${DESKTOP_RUNNING_ICON} ${runningDest}`)
        console.log(`build-web-exe: [dry-run] set Windows PE subsystem GUI ${launcher}`)
      } else {
        await copyFile(DESKTOP_ICON, iconDest)
        await copyFile(DESKTOP_RUNNING_ICON, runningDest)
        setWindowsPeSubsystem(launcher, 'gui')
        console.log(`build-web-exe: Windows PE subsystem GUI: ${launcher}`)
      }
    }
    const marketAlias = join(product, target.platform === 'win' ? 'dsh.exe' : 'dsh')
    if (resolve(marketAlias) !== resolve(launcher)) {
      if (this.cli.dryRun) console.log(`build-web-exe: [dry-run] copy ${launcher} ${marketAlias}`)
      else {
        await copyFile(launcher, marketAlias)
        console.log(`build-web-exe: market CLI alias: ${marketAlias}`)
      }
    }
    await this.writeVersion(product)
    await this.writeReadme(product)
    return [product, launcher]
  }

  /**
   * Put the target node-pty addon in the product closure. Linux npm installs
   * build it from source, but legacy deploy omits that side-effect directory.
   * @param product - the product directory receiving the addon.
   * @param target - the pkg target whose native addon is being staged.
   */
  private async prepareNativePty(product: string, target: Target): Promise<void> {
    const stagedBuild = join(product, 'node_modules', 'node-pty', 'build')
    if (this.cli.dryRun) console.log(`build-web-exe: [dry-run] rm -rf ${stagedBuild}`)
    else await rm(stagedBuild, { recursive: true, force: true })
    if (target.platform !== 'linux') return
    const source = join(root, 'packages', 'subprocess', 'subprocess-local', 'node_modules', 'node-pty', 'build', 'Release', 'pty.node')
    const destination = join(stagedBuild, 'Release', 'pty.node')
    if (this.cli.dryRun) {
      console.log(`build-web-exe: [dry-run] cp ${source} ${destination}`)
      return
    }
    const host = Target.host()
    if (target.platform !== host.platform || target.arch !== host.arch) {
      throw new Error(
        'build-web-exe: build the Linux runtime on its target architecture; '
        + `target ${target.platform}-${target.arch} does not match host ${host.platform}-${host.arch}.`,
      )
    }
    await mkdir(dirname(destination), { recursive: true })
    await copyFile(source, destination)
  }

  /**
   * Write the product version stamp next to the launcher.
   * @param product - the product directory.
   */
  private async writeVersion(product: string): Promise<void> {
    const path = join(product, 'VERSION')
    if (this.cli.dryRun) {
      console.log(`build-web-exe: [dry-run] write ${path}`)
      return
    }
    await writeFile(path, this.cli.productVersion + '\n')
  }

  /**
   * Write a short start guide next to the launcher.
   * @param product - the product directory.
   */
  private async writeReadme(product: string): Promise<void> {
    const text = [
      'DeepSeek Harness Web desktop',
      `Version ${this.cli.productVersion}`,
      '',
      'Double-click dsh-web.exe (or dsh-web on macOS/Linux) to start the GUI.',
      'Keep this whole folder together; the exe is only a launcher.',
      'No system Node.js or Python install is required; the exe embeds Node, and node_modules/ is shipped.',
      'A Chromium browser (Edge or Chrome) is used for the window; Windows already includes Edge.',
      'On Windows a splash window shows progress, then the GUI opens. The tray icon keeps the server running after you close the window. Right-click it to show the GUI, start or stop the service, open Settings, or exit.',
      'On macOS/Linux, close the app window or the console to stop the server.',
      'User data lives in the .config folder beside this exe (same role as ~/.dsh).',
      'Rebuilding this folder keeps .config.',
      'Set the API key in Settings → Models; that writes .config/.credentials.yaml.',
      'You can also put DEEPSEEK_API_KEY in .config/.env or a .env beside the exe.',
      '',
      '双击 dsh-web.exe 即可打开 Web 界面。',
      '请保持整个文件夹完整，不要只复制 exe。',
      '不需要安装 Node.js 或 Python；exe 内嵌 Node，node_modules/ 是随包运行时。',
      '界面用 Edge 或 Chrome 打开；Windows 自带 Edge。',
      'Windows 启动时会显示进度闪窗，加载完成后打开主界面。关闭窗口后托盘图标仍保持服务运行。右键可显示主界面、启动或停止服务、打开系统设置，或退出。',
      'macOS/Linux 关闭应用窗口或控制台即可停止服务。',
      '用户数据在本目录的 .config 文件夹中，作用等同于 ~/.dsh。',
      '再次构建会保留 .config。',
      '在「设置 → 模型」中填写 API key，会写入 .config/.credentials.yaml。',
      '也可以把 DEEPSEEK_API_KEY 写在 .config/.env 或本目录的 .env 里。',
      '',
    ].join('\n')
    const path = join(product, 'README.txt')
    if (this.cli.dryRun) {
      console.log(`build-web-exe: [dry-run] write ${path}`)
      return
    }
    await writeFile(path, text)
  }

  /**
   * Print each product path and, outside dry-run mode, its size.
   * @param products - the product paths returned by {@link pack}.
   */
  printProducts(products: string[]): void {
    console.log(this.cli.dryRun ? 'build-web-exe: [dry-run] would produce:' : 'build-web-exe: products:')
    for (const path of products) {
      if (this.cli.dryRun) {
        console.log(`  ${path}`)
        continue
      }
      if (!existsSync(path)) {
        console.log(`  ${path}`)
        continue
      }
      const info = statSync(path)
      if (info.isDirectory()) {
        console.log(`  ${path}${sep}`)
        continue
      }
      const megabytes = info.size / (1024 * 1024)
      console.log(`  ${path}  (${megabytes.toFixed(1)} MB)`)
    }
  }

  /**
   * Run one subprocess with inherited stdio. Spawn and non-zero-exit errors
   * include the command; dry runs only print it.
   * @param label - the step name used in logs and error messages.
   * @param command - the executable.
   * @param args - its arguments.
   */
  private async run(label: string, command: string, args: string[]): Promise<void> {
    const printable = formatCommand(command, args)
    if (this.cli.dryRun) {
      console.log(`build-web-exe: [dry-run] ${printable}`)
      return
    }
    console.log(`build-web-exe: ${label}: ${printable}`)
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(command, args, {
        cwd: root,
        stdio: 'inherit',
        // Artifact builds must not mutate or validate a developer's Git hooks.
        // Do not set CI=true: pnpm 10 then runs `pnpm install --production`,
        // which removes lefthook and then fails the lefthook postinstall.
        // Unset CI too: GitHub Actions always injects CI=true.
        env: { ...process.env, LEFTHOOK: '0', CI: '' },
        shell: process.platform === 'win32',
      })
      child.once('error', (error) => {
        reject(new Error(`build-web-exe: ${label} failed to spawn: ${error.message} (${printable})`))
      })
      child.once('exit', (code, signal) => {
        if (code === 0) {
          resolvePromise()
          return
        }
        const cause = code === null ? `signal ${signal ?? 'unknown'}` : `exit code ${code}`
        reject(new Error(`build-web-exe: ${label} failed (${cause}): ${printable}`))
      })
    })
  }
}

async function main(): Promise<void> {
  const cli = BuildCli.parse(process.argv.slice(2))
  const pipeline = new WebExeBuild(cli)
  console.log(`build-web-exe: targets: ${cli.targets.map(target => target.spec).join(', ')}`)
  console.log(`build-web-exe: version: ${cli.productVersion}`)
  console.log(`build-web-exe: staging: ${pipeline.staging}`)
  if (cli.restoreOnly) {
    await pipeline.restoreExisting()
    return
  }
  await pipeline.build()
  await pipeline.deployStaging()
  // Seeding runs on the staging tree, so every packed product copy inherits
  // the seeded .config/profiles/web while an existing product folder's own
  // preserved .config keeps winning over the fresh seed.
  await pipeline.seedBuiltinPlugins()
  const products: string[] = []
  for (const target of cli.targets) products.push(...await pipeline.pack(target))
  pipeline.printProducts(products)
}

await main()
