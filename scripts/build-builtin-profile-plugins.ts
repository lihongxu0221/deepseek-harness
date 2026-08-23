/**
 * Install the built-in community plugins into a packaged Web desktop's web
 * profile (`.config/profiles/web`).
 *
 * A packaged product ships without a `.config` home, so a first launch would
 * boot the bare `base + web-app` composition and leave the market and UI
 * plugins uninstalled until someone installs them through the market itself.
 * This step runs inside `build-web-exe` after the staging deploy and
 * standalone through `--product`, so the product boots with the plugins listed
 * in `builtin-profile-plugins.json` already installed under the profile's own
 * `node_modules` — resolved by pnpm exactly like a manual
 * `dsh plugin --profile web add`, peers included through the installation
 * fallback healed at launch.
 *
 * Merge policy: an existing profile is never reordered or pruned. Missing
 * bundle entries are appended after the user's entries, missing dependency
 * specs are set to the pinned exact version, and a present-but-different spec
 * stays user-owned unless `refresh` opts in. When no manifest field changed
 * and every plugin already resolves from the profile, the step is a no-op that
 * skips pnpm entirely, so offline rebuilds stay offline.
 * @module scripts/build-builtin-profile-plugins
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  DEFAULT_PROFILE_BUNDLES,
  healProfileVirtualStoreDir,
  initProfile,
  PROFILE_TEMPLATES,
  PROFILES_DIR,
  readProfileManifest,
  writeProfileManifest,
  type ProfileManifest,
} from '../packages/boot/app-boot/src/profile.ts'
import { PACKAGED_WEB_HOME_DIR } from './preserve-packaged-web-home.ts'

/** Diagnostic prefix on every thrown error, matching sibling build scripts. */
const BIN = 'build-builtin-profile-plugins'

/** Repository root; the script resolves its manifest and runs pnpm from here. */
const ROOT = resolve(import.meta.dirname, '..')

/** The plugin pin list next to this script. */
const MANIFEST_FILENAME = 'builtin-profile-plugins.json'

/** An exact semver version; range or tag specs would break reproducible builds. */
const EXACT_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

/** The plugins this step installs, pinned to exact versions for reproducible products. */
export interface BuiltinManifest {
  /** The target profile name under `.config/profiles`. */
  readonly profile: string
  /** Plugin package name → pinned exact npm version. */
  readonly plugins: Readonly<Record<string, string>>
  /** Dependency install scripts pnpm may run inside the profile; omitted means none. */
  readonly allowBuilds?: Readonly<Record<string, boolean>>
}

/**
 * Read and validate the builtin plugin pin list.
 * @param path - absolute path of `builtin-profile-plugins.json`.
 * @returns the parsed manifest.
 * @throws when the file is unreadable, is not the expected object shape, or pins a non-exact version.
 */
export function loadBuiltinManifest(path: string): BuiltinManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`${BIN}: failed to read builtin plugin manifest ${path}: ${String(error)}`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${BIN}: builtin plugin manifest ${path} must hold a JSON object`)
  }
  const record = parsed as Record<string, unknown>
  if (typeof record.profile !== 'string' || record.profile === '') {
    throw new Error(`${BIN}: builtin plugin manifest ${path} requires a non-empty "profile" string`)
  }
  const plugins = record.plugins
  if (plugins === null || typeof plugins !== 'object' || Array.isArray(plugins)) {
    throw new Error(`${BIN}: builtin plugin manifest ${path} requires a "plugins" object`)
  }
  for (const [name, version] of Object.entries(plugins as Record<string, unknown>)) {
    if (typeof version !== 'string' || !EXACT_VERSION_PATTERN.test(version)) {
      throw new Error(
        `${BIN}: builtin plugin manifest ${path} pins ${JSON.stringify(name)} to ${JSON.stringify(version)}; `
        + 'only exact semver versions keep product builds reproducible',
      )
    }
  }
  const allowBuilds = record.allowBuilds
  if (allowBuilds !== undefined) {
    if (allowBuilds === null || typeof allowBuilds !== 'object' || Array.isArray(allowBuilds)) {
      throw new Error(`${BIN}: builtin plugin manifest ${path} field "allowBuilds" must be an object`)
    }
    for (const [name, allowed] of Object.entries(allowBuilds as Record<string, unknown>)) {
      if (typeof allowed !== 'boolean') {
        throw new Error(`${BIN}: builtin plugin manifest ${path} allows ${JSON.stringify(name)} with a non-boolean value`)
      }
    }
  }
  return parsed as BuiltinManifest
}

/**
 * The profile manifest `initProfile` writes for a shipped template, rebuilt as
 * a value so merge planning can run before the directory exists. The unit test
 * guards this value against drift from the real initializer.
 * @param profileName - the profile directory basename.
 * @returns the fresh manifest value.
 */
export function buildFreshProfileManifest(profileName: string): ProfileManifest & { private: boolean } {
  return {
    name: `dsh-profile-${profileName}`,
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: [...(PROFILE_TEMPLATES[profileName] ?? DEFAULT_PROFILE_BUNDLES)] } },
  }
}

/** What merging the builtin plugins into one profile would change. */
export interface ProfileMergePlan {
  /** The manifest to persist; the input reference itself when nothing changed. */
  readonly manifest: ProfileManifest
  /** Bundle entries appended after the existing ones, in pin-list order. */
  readonly addedBundles: string[]
  /** Dependency specs newly set to their pinned versions. */
  readonly addedDependencies: string[]
  /** Dependency specs overwritten because refresh was requested. */
  readonly refreshedDependencies: string[]
  /** Existing dependency specs kept because they differ and refresh was off. */
  readonly conflicts: Readonly<Record<string, string>>
}

/**
 * Plan adding the builtin plugins to one profile manifest without writing.
 * Existing bundle order and foreign fields are preserved verbatim; only
 * missing entries are appended. A differing existing dependency spec is a
 * conflict that stays user-owned unless refresh opts in.
 * @param existing - the current profile manifest; `undefined` plans against a
 *   freshly initialized profile whose bundles come from `freshBundles`.
 * @param freshBundles - the bundle list a just-initialized profile would have.
 * @param plugins - the builtin pins to merge in.
 * @param options - `refresh` overwrites conflicting dependency specs.
 * @returns the planned manifest plus what changed.
 */
export function planProfileMerge(
  existing: ProfileManifest | undefined,
  freshBundles: readonly string[],
  plugins: Readonly<Record<string, string>>,
  options: { refresh?: boolean } = {},
): ProfileMergePlan {
  const base: ProfileManifest = existing ?? {
    name: '',
    dependencies: {},
    dsh: { profile: { bundles: [...freshBundles] } },
  }
  const bundles = [...(base.dsh?.profile?.bundles ?? [])]
  const addedBundles = Object.keys(plugins).filter(name => !bundles.includes(name))
  bundles.push(...addedBundles)

  const dependencies = { ...(base.dependencies ?? {}) }
  const addedDependencies: string[] = []
  const refreshedDependencies: string[] = []
  const conflicts: Record<string, string> = {}
  for (const [name, version] of Object.entries(plugins)) {
    const current = dependencies[name]
    if (current === undefined) {
      dependencies[name] = version
      addedDependencies.push(name)
    } else if (current !== version) {
      if (options.refresh === true) {
        dependencies[name] = version
        refreshedDependencies.push(name)
      } else {
        conflicts[name] = current
      }
    }
  }

  if (existing !== undefined && addedBundles.length === 0 && addedDependencies.length === 0
    && refreshedDependencies.length === 0) {
    return { manifest: existing, addedBundles, addedDependencies, refreshedDependencies, conflicts }
  }
  return {
    manifest: {
      ...base,
      dependencies,
      dsh: {
        ...(base.dsh ?? {}),
        profile: { ...(base.dsh?.profile ?? {}), bundles },
      },
    },
    addedBundles,
    addedDependencies,
    refreshedDependencies,
    conflicts,
  }
}

/** Options for {@link seedBuiltinProfilePlugins}. */
export interface SeedOptions {
  /** Print actions instead of writing files or running pnpm. */
  readonly dryRun?: boolean
  /** Plugin pin list override; defaults to the file beside this script. */
  readonly manifestPath?: string
  /** Overwrite conflicting dependency specs with the pinned versions. */
  readonly refresh?: boolean
  /** Progress sink; defaults to console.log. */
  readonly log?: (line: string) => void
  /** Install override for tests; defaults to pnpm install in the profile directory. */
  readonly runInstall?: (profileDir: string) => Promise<void>
}

/** Summary of one seeding pass over one product directory. */
export interface SeedResult {
  /** Whether the profile manifest was rewritten. */
  readonly changed: boolean
  /** Whether pnpm install ran. */
  readonly ranInstall: boolean
  /** Whether everything was already satisfied (no write, no install). */
  readonly upToDate: boolean
  readonly addedBundles: readonly string[]
  readonly addedDependencies: readonly string[]
  readonly refreshedDependencies: readonly string[]
  readonly conflicts: Readonly<Record<string, string>>
}

/** Whether the plugin package resolves from the profile's own node_modules. */
function pluginResolvable(profileDir: string, name: string): boolean {
  return existsSync(join(profileDir, 'node_modules', ...name.split('/'), 'package.json'))
}

/**
 * Resolve the plugin pin list location. Loaders that rewrite module URLs
 * (vite-node under vitest) leave an unreliable `import.meta.dirname`, so the
 * repository-layout fallback keeps tests and tools honest.
 * @returns an absolute manifest path.
 */
function defaultManifestPath(): string {
  // Loaders that rewrite module URLs (vite-node) leave dirname unset even
  // though Node's types call it required, hence the widened read.
  const scriptDirname = (import.meta as { dirname?: string }).dirname
  return join(scriptDirname ?? join(process.cwd(), 'scripts'), MANIFEST_FILENAME)
}

/**
 * Merge the builtin native-build allowlist into a profile pnpm-workspace.yaml.
 * pnpm refuses to run dependency install scripts that the workspace does not
 * list, and several builtin plugins need them (node-pty and ssh2 ship native
 * code; cloudflared downloads its tunnel binary). A file that already declares
 * an allowBuilds block is owner-managed and returned untouched.
 * @param existingText - current workspace file contents.
 * @param allowBuilds - package name → allowed mapping to merge.
 * @returns the updated file text, or null when nothing needs changing.
 */
export function planAllowBuildsAppend(
  existingText: string,
  allowBuilds: Readonly<Record<string, boolean>>,
): string | null {
  if (/^allowBuilds:/mu.test(existingText)) return null
  const entries = Object.entries(allowBuilds)
  if (entries.length === 0) return null
  const block = [
    '',
    '# Native install scripts the builtin plugins need at runtime; pnpm blocks',
    '# unlisted builds, so this mirrors the installation root reviewed list.',
    'allowBuilds:',
    ...entries.map(([name, allowed]) => `  ${name}: ${allowed}`),
  ].join('\n')
  return existingText.replace(/\n*$/u, '\n') + block + '\n'
}

/**
 * Seed one product directory's web profile with the builtin plugins. Creates
 * the profile skeleton on first run, merges the pinned plugins into the
 * manifest, installs them with pnpm when anything is missing, and verifies
 * every plugin resolves afterwards. Safe to run repeatedly: an up-to-date
 * profile makes this a no-op without touching the network.
 * @param productDir - the packaged product folder whose `.config` receives the profile.
 * @param options - see {@link SeedOptions}.
 * @returns what the pass changed.
 * @throws when the profile manifest is unreadable or a plugin fails to resolve after install.
 */
export async function seedBuiltinProfilePlugins(
  productDir: string,
  options: SeedOptions = {},
): Promise<SeedResult> {
  const log = options.log ?? ((line: string): void => {
    console.log(line)
  })
  const dryRun = options.dryRun === true
  const builtin = loadBuiltinManifest(options.manifestPath ?? defaultManifestPath())
  const profileDir = join(productDir, PACKAGED_WEB_HOME_DIR, PROFILES_DIR, builtin.profile)
  const freshBundles = PROFILE_TEMPLATES[builtin.profile] ?? DEFAULT_PROFILE_BUNDLES
  log(`${BIN}: seeding profile ${builtin.profile} with ${Object.keys(builtin.plugins).join(', ')}`)

  const skeletonExists = existsSync(join(profileDir, 'package.json'))
  if (!skeletonExists && !dryRun) {
    log(`${BIN}: initializing profile directory ${profileDir}`)
    initProfile(profileDir, freshBundles)
  }
  // Re-read after init so the merge keeps initProfile's name and private flag.
  const existing = existsSync(join(profileDir, 'package.json')) ? readProfileManifest(BIN, profileDir) : undefined
  const plan = planProfileMerge(existing, freshBundles, builtin.plugins, { refresh: options.refresh === true })
  for (const [name, spec] of Object.entries(plan.conflicts)) {
    log(`${BIN}: keeping user-pinned ${name}@${spec} (pass --refresh to take ${builtin.plugins[name]})`)
  }

  const changed = plan.manifest !== existing
  const missingBefore = Object.keys(builtin.plugins).filter(name => !pluginResolvable(profileDir, name))
  if (!changed && missingBefore.length === 0) {
    if (!dryRun) healProfileVirtualStoreDir(profileDir)
    log(`${BIN}: profile already up to date`)
    return {
      changed: false,
      ranInstall: false,
      upToDate: true,
      addedBundles: [],
      addedDependencies: [],
      refreshedDependencies: [],
      conflicts: plan.conflicts,
    }
  }

  if (changed) {
    if (dryRun) log(`${BIN}: [dry-run] would write ${join(profileDir, 'package.json')}`)
    else writeProfileManifest(profileDir, plan.manifest)
  }
  if (dryRun) {
    log(`${BIN}: [dry-run] would run pnpm install in ${profileDir}`)
    return {
      changed,
      ranInstall: false,
      upToDate: false,
      addedBundles: plan.addedBundles,
      addedDependencies: plan.addedDependencies,
      refreshedDependencies: plan.refreshedDependencies,
      conflicts: plan.conflicts,
    }
  }

  log(`${BIN}: installing builtin plugins into ${profileDir}`)
  healProfileVirtualStoreDir(profileDir)
  if (builtin.allowBuilds !== undefined) {
    const workspacePath = join(profileDir, 'pnpm-workspace.yaml')
    const current = existsSync(workspacePath) ? readFileSync(workspacePath, 'utf8') : ''
    const merged = planAllowBuildsAppend(current, builtin.allowBuilds)
    if (merged !== null) {
      log(`${BIN}: allowing native build scripts in ${workspacePath}`)
      writeFileSync(workspacePath, merged)
    }
  }
  const runInstall = options.runInstall ?? runPnpmInstall
  await runInstall(profileDir)
  healProfileVirtualStoreDir(profileDir)

  const unresolved = Object.keys(builtin.plugins).filter(name => !pluginResolvable(profileDir, name))
  if (unresolved.length > 0) {
    throw new Error(
      `${BIN}: builtin plugins did not resolve in ${profileDir} after install: ${unresolved.join(', ')}`,
    )
  }
  log(`${BIN}: builtin plugins ready: ${Object.keys(builtin.plugins).join(', ')}`)
  return {
    changed,
    ranInstall: true,
    upToDate: false,
    addedBundles: plan.addedBundles,
    addedDependencies: plan.addedDependencies,
    refreshedDependencies: plan.refreshedDependencies,
    conflicts: plan.conflicts,
  }
}

/** Run pnpm install inside the profile directory with inherited stdio. */
async function runPnpmInstall(profileDir: string): Promise<void> {
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const args = ['install', '--dir', profileDir, '--config.confirmModulesPurge=false']
  const printable = `${command} ${args.join(' ')}`
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: 'inherit',
      // Artifact steps must not mutate Git hooks or trip CI-only pnpm behavior.
      env: { ...process.env, LEFTHOOK: '0', CI: '' },
      shell: process.platform === 'win32',
    })
    child.once('error', (error) => {
      rejectPromise(new Error(`${BIN}: failed to spawn pnpm: ${error.message} (${printable})`))
    })
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      const cause = code === null ? `signal ${signal ?? 'unknown'}` : `exit code ${code}`
      rejectPromise(new Error(`${BIN}: pnpm install failed (${cause}): ${printable}`))
    })
  })
}

interface SeedCli {
  readonly products: readonly string[]
  readonly refresh: boolean
  readonly dryRun: boolean
}

const USAGE_TEXT = [
  'Usage: pnpm exec tsx scripts/build-builtin-profile-plugins.ts --product <dir> [--product <dir>...] [--refresh] [--dry-run]',
  '',
  '  --product <dir>  packaged product folder to seed (.config/profiles/web inside); repeatable, required.',
  '  --refresh        overwrite conflicting plugin dependency specs with the pinned versions.',
  '  --dry-run        print actions without writing files or running pnpm.',
  '  --help           print this help.',
  '',
  'Plugins come from scripts/builtin-profile-plugins.json; the packaging build',
  '(build-web-exe) runs the same seeding automatically on the staging tree.',
].join('\n')

/**
 * Parse argv; help prints usage and exits 0.
 * @param argv - arguments after the script name.
 * @returns the validated CLI configuration.
 */
function parseSeedCli(argv: string[]): SeedCli {
  const values = parseArgs({
    args: argv,
    options: {
      product: { type: 'string', multiple: true },
      refresh: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  }).values
  if (values.help) {
    console.log(USAGE_TEXT)
    process.exit(0)
  }
  if (values.product === undefined || values.product.length === 0) {
    throw new Error(`${BIN}: at least one --product <dir> is required`)
  }
  return { products: values.product, refresh: values.refresh, dryRun: values['dry-run'] }
}

async function main(): Promise<void> {
  const cli = parseSeedCli(process.argv.slice(2))
  for (const product of cli.products) {
    const result = await seedBuiltinProfilePlugins(resolve(product), {
      dryRun: cli.dryRun,
      refresh: cli.refresh,
    })
    const outcome = result.upToDate ? 'up to date' : (result.changed || result.ranInstall) ? 'seeded' : 'no changes'
    console.log(`${BIN}: ${product} -> ${outcome}`)
  }
}

// Only direct CLI execution runs main; imports (tests, build-web-exe) stay side-effect free.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  await main()
}
