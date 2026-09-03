/**
 * Portable harness home for the packaged Web desktop executable.
 * @module @deepseek-ai/dsh/packaged-web-home
 */

import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { DSH_HOME_ENV, resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** Directory name for the packaged executable's harness home, beside the exe. */
export const PACKAGED_WEB_HOME_DIR = '.config'

/** Environment name host plugins use when `process.argv` has no `--profile`. */
export const DSH_PROFILE_ENV = 'DSH_PROFILE'

/** Profile the packaged GUI always boots. */
export const PACKAGED_WEB_PROFILE = 'web'

/**
 * Resolve the packaged executable's default harness home.
 * @param execPath - `process.execPath` of the launcher.
 * @returns `<exeDir>/.config`.
 */
export function packagedWebHomeDir(execPath: string): string {
  return join(dirname(execPath), PACKAGED_WEB_HOME_DIR)
}

/**
 * Point an unset `$DSH_HOME` at `<exeDir>/.config` and create that directory.
 * An explicit `$DSH_HOME` still wins. Source `pnpm dsh` does not call this.
 * @param execPath - `process.execPath` of the launcher.
 * @param env - environment mapping that may already contain `DSH_HOME`.
 * @param mkdir - replaceable directory creator.
 * @returns the resolved harness home that subsequent boot will use.
 */
export function applyPackagedWebHome(
  execPath: string,
  env: NodeJS.ProcessEnv = process.env,
  mkdir: (path: string) => void = (path) => {
    mkdirSync(path, { recursive: true, mode: 0o700 })
  },
): string {
  const existing = env[DSH_HOME_ENV]
  if (existing === undefined || existing.trim().length === 0) {
    env[DSH_HOME_ENV] = resolve(packagedWebHomeDir(execPath))
  }
  const home = resolveDshHome(undefined, env)
  mkdir(home)
  return home
}

/**
 * Record that this process boots the packaged `web` profile.
 * The GUI launcher calls {@link bootProfile} with that name and does not put
 * `--profile web` on `process.argv`. Host plugins that resolve the boot
 * profile from argv or `$DSH_PROFILE` need this process-wide value.
 * @param env - environment mapping to write.
 */
export function applyPackagedWebProfile(env: NodeJS.ProcessEnv = process.env): void {
  env[DSH_PROFILE_ENV] = PACKAGED_WEB_PROFILE
}
