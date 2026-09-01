/** Product-folder version stamp for the packaged Web desktop. */

const ITERATION = /^[0-9]+$/u

/**
 * Join the repository package version with a winexe build iteration.
 * Local packs omit the suffix; CI supplies a monotonic run number.
 * @param baseVersion - `package.json` version, e.g. `0.1.1-rc.2`.
 * @param iteration - decimal GitHub run number, or empty for a local pack.
 * @returns the stamped product version.
 */
export function packagedWebExeVersion(baseVersion: string, iteration = ''): string {
  const base = baseVersion.trim()
  if (base === '') throw new Error('packaged web exe version base is empty.')
  const iter = iteration.trim()
  if (iter === '') return base
  if (!ITERATION.test(iter)) {
    throw new Error(`packaged web exe version iteration ${JSON.stringify(iteration)} must be a decimal integer.`)
  }
  return `${base}.winexe.${iter}`
}

/**
 * Resolve the product stamp from an explicit flag, then `DSH_WEB_EXE_VERSION`,
 * then `DSH_WEB_EXE_ITERATION` against the package version.
 * @param baseVersion - `package.json` version.
 * @param env - process environment.
 * @param explicit - `--product-version` when the caller passed one.
 * @returns the stamped product version.
 */
export function resolvePackagedWebExeVersion(
  baseVersion: string,
  env: NodeJS.ProcessEnv,
  explicit?: string,
): string {
  const flagged = explicit?.trim() ?? ''
  if (flagged !== '') return flagged
  const full = env.DSH_WEB_EXE_VERSION?.trim() ?? ''
  if (full !== '') return full
  return packagedWebExeVersion(baseVersion, env.DSH_WEB_EXE_ITERATION ?? '')
}
