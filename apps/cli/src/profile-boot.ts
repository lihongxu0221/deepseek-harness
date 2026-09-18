/**
 * Shared profile boot for every `dsh` surface: resolve the profile, stack its
 * patch layers (bundle layers in `dsh.profile.bundles` order, the profile's
 * own `cordis.patch.yml`, `--patch` overlays, the telemetry switch, and the
 * apiProxy-dependent disable overlay), mount the
 * tree over the profile's empty root config, and wire fail-loud plus bounded shutdown.
 *
 * App flags are not the launcher's business: the invocation's inner arguments
 * are provided to the tree through `ctx.cmdlineArgs`, where any injected app
 * plugin may read the same immutable snapshot.
 * @module @deepseek-ai/dsh/profile-boot
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FiberState, type Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import {
  boot,
  readProfilePatches,
  createProfileResolutionGeneration,
  healArchiveManagerHome,
  healHostApiproxyRpcStub,
  healProfileVirtualStoreDir,
  healProfilesModuleFallback,
  healIsolatedProfileModuleFallback,
  initProfile,
  installFailLoud,
  loadOverlayPatches,
  loadProfile,
  PluginPackages,
  PROFILE_PATCH_FILENAME,
  PROFILE_TEMPLATES,
  resolveProfileDir,
  type ProfileContext,
  type Profile,
  type ProfileResolutionGeneration,
  type ProfileResolutionMode,
} from '@deepseek-ai/dsh-app-boot'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { installProxyFromEnvironment } from '@deepseek-ai/dsh-http-proxy'
import { DSH_LAUNCH_ENVIRONMENT_KEY, type LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { provideCmdline, type AppReady } from '@deepseek-ai/dsh-cmdline'
import { createProcessShutdown, type ProcessShutdown } from './process-shutdown.ts'

const NAME = 'dsh'

/** Launcher-owned readiness signal committed only after boot and host setup succeed. */
function createAppReady(): { service: AppReady; commit(): void } {
  let ready = false
  const listeners = new Set<() => void>()
  return {
    service: {
      onReady(listener) {
        if (ready) {
          listener()
          return () => {}
        }
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    commit() {
      if (ready) return
      ready = true
      for (const listener of [...listeners]) listener()
      listeners.clear()
    },
  }
}

/**
 * The home-level user patch layer (`$DSH_HOME/cordis.patch.yml`), applied
 * over every profile's own layer. Resolved per call, not at module load:
 * `$DSH_HOME` may be set by the test or launcher after import.
 * @returns the absolute patch-file path.
 */
export function homePatchPath(): string {
  return join(resolveDshHome(), PROFILE_PATCH_FILENAME)
}

/** Absolute path of this dsh installation's package.json (both anchors: src/ and lib/ sit one level under apps/cli). */
export const INSTALL_ANCHOR = fileURLToPath(new URL('../package.json', import.meta.url))

/**
 * Row ids to disable because they inject `apiProxy`, which this product does
 * not provide. Empty: current seeded `@linxin666/dsh-web-all` host plugins
 * inject `webServer` / `typertGateway` / `connection` instead. Disabling
 * `web-ui-remote-web-ui` left `/api/update` unmounted while the client still
 * rendered Check for updates.
 */
const APIPROXY_DEPENDENT_ROW_IDS: readonly string[] = []

/** The empty root entry list every profile tree patches over. */
const PROFILE_ROOT_CONFIG = `# dsh profile root — an empty entry list. The tree is composed as patches:
# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any
# --patch overlays. Edit cordis.patch.yml, not this file.
[]
`

/** Root config filename inside a profile directory. */
export const PROFILE_ROOT_FILENAME = 'cordis.yml'

/**
 * Initialize a missing profile from one shipped template. This copies only
 * the template's bundle list; local state from the
 * same-named shipped profile is not read, and no inheritance metadata is
 * persisted. Shipped profile names are reserved, and the target directory is
 * claimed exclusively so existing or concurrent state is never reused.
 * @param name - the new profile name.
 * @param fromDefaultProfile - shipped profile template to copy.
 * @param home - Harness home containing the profile directory.
 * @throws when the template is unknown, the target name is shipped, or the target directory exists.
 */
export function initializeProfileFromDefault(
  name: string,
  fromDefaultProfile: string,
  home: string = resolveDshHome(),
): void {
  const dir = resolveProfileDir(name, home)
  const template = Object.hasOwn(PROFILE_TEMPLATES, fromDefaultProfile)
    ? PROFILE_TEMPLATES[fromDefaultProfile]
    : undefined
  if (template === undefined) {
    const expected = Object.keys(PROFILE_TEMPLATES).sort().map(value => JSON.stringify(value)).join(', ')
    throw new Error(
      `${NAME}: unknown default profile ${JSON.stringify(fromDefaultProfile)}; expected one of ${expected}`,
    )
  }
  if (Object.hasOwn(PROFILE_TEMPLATES, name)) {
    throw new Error(
      `${NAME}: profile ${JSON.stringify(name)} is shipped and cannot be a custom profile target; `
      + 'omit --from-default-profile to use it',
    )
  }
  mkdirSync(dirname(dir), { recursive: true })
  try {
    mkdirSync(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const manifestPath = join(dir, 'package.json')
    if (existsSync(manifestPath)) {
      throw new Error(
        `${NAME}: profile ${JSON.stringify(name)} already exists at ${manifestPath}; `
        + 'omit --from-default-profile to use it',
      )
    }
    throw new Error(
      `${NAME}: profile directory ${dir} already exists; choose an unused profile name`,
    )
  }
  try {
    initProfile(dir, template.bundles)
  } catch (error) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `${NAME}: profile initialization failed and ${dir} could not be removed`,
      )
    }
    throw error
  }
}

/**
 * Disable seeded community plugins that inject `apiProxy`, which this product
 * does not provide. One pending inject fail-louds the whole web profile. Only
 * ids present in the composed tree become patches, so a custom profile without
 * those rows is unchanged.
 * @param rowIds - ids already present after bundle, user, home, and `--patch` layers.
 * @returns id-targeted `disabled: true` patches, in seeded-row order.
 */
export function resolveApiproxyDependentDisablePatches(
  rowIds: ReadonlySet<string>,
): PatchOptions[] {
  return APIPROXY_DEPENDENT_ROW_IDS
    .filter(id => rowIds.has(id))
    .map(id => ({ id, disabled: true }))
}

/**
 * Load a resolved profile for `name` and (re)write the empty root config. The
 * root is always rewritten: the whole composition is patch layers, and the
 * vendored Loader's tree write-back (a plugin self-disposing persists the
 * current tree) can bake composed rows into this file — which would duplicate
 * every bundle insert on the next boot. The file exists on disk only because
 * the Loader needs a real include root to anchor `baseUrl` at the profile
 * directory (the config dump anchors on the same file, so both compose over
 * the identical base).
 * @param name - the profile name.
 * @param userLayer - `false` skips parsing `cordis.patch.yml` (the default dump).
 * @param fromDefaultProfile - shipped template used once to initialize a missing profile.
 * @returns the loaded profile.
 * @throws when explicit initialization names an unknown template or an existing profile.
 */
export function prepareProfile(name: string, userLayer = true, fromDefaultProfile?: string): Profile {
  if (fromDefaultProfile !== undefined) initializeProfileFromDefault(name, fromDefaultProfile)
  const profile = loadProfile(NAME, name, INSTALL_ANCHOR, undefined, { userLayer })
  healProfileVirtualStoreDir(profile.dir)
  healArchiveManagerHome(profile.dir)
  healHostApiproxyRpcStub(profile.dir)
  writeFileSync(join(profile.dir, PROFILE_ROOT_FILENAME), PROFILE_ROOT_CONFIG)
  return profile
}

/** One profile's patch layers, in application order. */
interface ComposedProfile {
  profile: Profile
  /** Immutable package fallback selected before any plugin imports. */
  resolution: ProfileResolutionGeneration
  /** Command-line overlay contents, frozen for this invocation. */
  overlays: PatchOptions[]
}

/**
 * Load `name` and compose its effective patch stack: bundle layers in
 * `dsh.profile.bundles` order (a base-backed profile gets the base bundle's
 * platform-gated shell rows), the profile's user layer, the home-level user
 * layer (`$DSH_HOME/cordis.patch.yml` — machine-local preferences that apply
 * to every profile, so it outranks the per-profile layer), `--patch` overlays,
 * then the telemetry switch.
 * @param name - the profile name.
 * @param patchFiles - `--patch` overlay paths, in argv order.
 * @param resolutionMode - runtime lookup, disk links, or dual verification of both.
 * @param fromDefaultProfile - shipped template for a missing named profile.
 * @param resolvedProfile - application-owned profile and installation.
 * @returns the profile and its patch layers.
 */
async function composeProfile(
  name: string,
  patchFiles: readonly string[],
  resolutionMode: ProfileResolutionMode,
  fromDefaultProfile?: string,
  resolvedProfile?: ResolvedProfileRuntime,
): Promise<ComposedProfile> {
  const profile = resolvedProfile?.profile ?? prepareProfile(name, true, fromDefaultProfile)
  if (resolvedProfile !== undefined) writeFileSync(join(profile.dir, PROFILE_ROOT_FILENAME), PROFILE_ROOT_CONFIG)
  const resolutionOptions = { installAnchor: resolvedProfile?.installAnchor ?? INSTALL_ANCHOR, profile }
  if (resolvedProfile !== undefined && resolutionMode !== 'runtime') healIsolatedProfileModuleFallback(resolvedProfile)
  const resolution = resolutionMode === 'runtime' || resolvedProfile !== undefined
    ? await createProfileResolutionGeneration(resolutionOptions)
    : await healProfilesModuleFallback(resolutionOptions)
  const overlays = [
    ...patchFiles.flatMap(file => loadOverlayPatches(NAME, resolve(file))),
    ...resolveApiproxyDependentDisablePatches(new Set(profile.layers.flatMap(layer => layer.patches.flatMap(patch => typeof patch.id === 'string' ? [patch.id] : [])))),
  ]
  return { profile, resolution, overlays }
}

/** An application-owned profile and its independent installation fallback. */
export interface ResolvedProfileRuntime {
  /** Profile already loaded from the application's own directory. */
  profile: Profile
  /** Absolute package.json path of the application's dsh installation. */
  installAnchor: string
}

/** Options for {@link runProfile}. */
export interface RunProfileOptions {
  /** This run's frozen environment snapshot, provided before any entry mounts. */
  environment: LaunchEnvironmentSnapshot
  /** The profile name to boot. */
  profile: string
  /** Loaded application profile; bypasses named profile initialization when supplied. */
  resolvedProfile?: ResolvedProfileRuntime | undefined
  /** Shipped template used once to initialize a missing profile. */
  fromDefaultProfile?: string | undefined
  /** `--patch` overlay paths, in argv order. */
  patchFiles: readonly string[]
  /** The invocation's inner arguments, handed to the tree through `ctx.cmdlineArgs`. */
  args: readonly string[]
  /** Application-owned package runtime, scoped to plugin package operations. */
  packageManager?: ProfileContext['packageManager']
  /** Module fallback backend; defaults to runtime. Plain Node callers may override it; pkg executables always use runtime. */
  resolutionMode?: ProfileResolutionMode
}

/** Options for {@link bootProfile}: compose and boot without process exit. */
export interface BootProfileOptions extends RunProfileOptions {
  /**
   * Plugin-requested exit through `ctx.appExit`. The CLI maps this to process
   * shutdown; the packaged Windows desktop maps it to stopping the web service
   * without exiting the tray host.
   */
  exit: (code: number) => void
  /**
   * When aborted, watcher-setup failures are treated as shutdown, not a broken
   * watch. The CLI aborts this on SIGINT/SIGTERM.
   */
  signal: AbortSignal
  /**
   * Receives the host context as soon as boot creates it, before entries mount,
   * so a signal during boot can still dispose the tree.
   */
  onHost?: (ctx: Context) => void
  /** Optional launcher-owned ready signal provided to `ctx.cmdlineArgs`. */
  ready?: AppReady
}

/**
 * Compose and boot one profile. Does not install fail-loud, signal handlers,
 * or process exit — those stay on {@link runProfile} so CLI surfaces keep
 * their shutdown semantics.
 * @param options - environment snapshot, profile, overlays, arguments, and the
 *   plugin exit hook.
 * @returns the settled root context. The caller owns `fiber.dispose()`.
 */
export async function bootProfile(options: BootProfileOptions): Promise<Context> {
  const packaged = (process as NodeJS.Process & { pkg?: unknown }).pkg !== undefined
  const resolutionMode = packaged ? 'runtime' : options.resolutionMode ?? 'runtime'
  const composed = await composeProfile(
    options.profile, options.patchFiles, resolutionMode, options.fromDefaultProfile, options.resolvedProfile,
  )
  const rootConfig = join(composed.profile.dir, PROFILE_ROOT_FILENAME)
  const profileContext: ProfileContext = {
    name: options.profile,
    ...(options.packageManager === undefined ? {} : { packageManager: options.packageManager }),
    dir: composed.profile.dir, patchPath: composed.profile.patchPath,
    installAnchor: options.resolvedProfile?.installAnchor ?? INSTALL_ANCHOR,
    startedBundles: composed.profile.layers.map(layer => layer.packageName),
    cwd: process.cwd(), home: resolveDshHome(),
    overlays: composed.overlays, telemetryDisabledEnv: process.env.DSH_TELEMETRY_DISABLED,
  }
  const ctx = await boot(NAME, rootConfig, readProfilePatches(NAME, profileContext, composed.profile), async (hostCtx) => {
    options.onHost?.(hostCtx)
    hostCtx.provide('profileContext', profileContext)
    hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, options.environment)
    await hostCtx.plugin(PluginPackages, resolutionMode === 'link' ? {} : {
      generation: composed.resolution,
      behavior: resolutionMode === 'dual' ? 'verify' : 'enforce',
    })
    provideCmdline(hostCtx, {
      args: options.args,
      exit: options.exit,
      ...(options.ready === undefined ? {} : { ready: options.ready }),
    })
  })
  return ctx
}

/**
 * Boot one profile invocation end to end and leave process lifetime to the
 * mounted plugins (or to a one-shot runner the composition mounts).
 * @param options - environment snapshot, profile name, overlays, and the booted app's own arguments.
 * @returns the settled root context and the shutdown controller.
 * @throws after disposing startup resources; cleanup failures retain the original error.
 */
export async function runProfile(options: RunProfileOptions): Promise<{ ctx: Context; shutdown: ProcessShutdown }> {
  const disposeProxy = await installProxyFromEnvironment(
    options.environment,
    (message) => { process.stderr.write(`${NAME}: ${message}\n`) },
  )

  const app: { current?: Context } = {}
  let disposal: Promise<void> | undefined
  const dispose = (): Promise<void> => disposal ??= (async () => {
    const failures: unknown[] = []
    for (const release of [() => app.current?.fiber.dispose(), disposeProxy]) {
      try { await release() } catch (error) { failures.push(error) }
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'dsh: profile cleanup failed')
  })()
  try {
    const appReady = createAppReady()
    const shutdown = createProcessShutdown(dispose)
    const signalShutdown = new AbortController()
    const interrupt = (code: number): void => {
      signalShutdown.abort()
      shutdown.interrupt(code)
    }
    process.on('SIGTERM', () => { interrupt(0) })
    process.on('SIGINT', () => { interrupt(130) })
    installFailLoud(NAME, process, async () => {
      await app.current?.fiber.dispose()
    })
    const ctx = await bootProfile({
      ...options,
      exit: code => void shutdown.shutdown(code),
      signal: signalShutdown.signal,
      onHost: (hostCtx) => { app.current = hostCtx },
      ready: appReady.service,
    })
    app.current = ctx
    if (!signalShutdown.signal.aborted
      && ctx.fiber.state === FiberState.ACTIVE
      && ctx.get('loader') !== undefined) {
      appReady.commit()
    }
    return { ctx, shutdown }
  } catch (error) {
    try { await dispose() } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'dsh: profile startup and cleanup failed')
    }
    throw error
  }
}
