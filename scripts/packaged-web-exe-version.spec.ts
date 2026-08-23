import { describe, expect, it } from 'vitest'
import { packagedWebExeVersion, resolvePackagedWebExeVersion } from './packaged-web-exe-version.ts'

describe('packagedWebExeVersion', () => {
  it('keeps the package version for a local pack', () => {
    expect(packagedWebExeVersion('0.1.1-rc.2')).toBe('0.1.1-rc.2')
    expect(packagedWebExeVersion('0.1.1-rc.2', '  ')).toBe('0.1.1-rc.2')
  })

  it('appends a winexe iteration for CI', () => {
    expect(packagedWebExeVersion('0.1.1-rc.2', '12')).toBe('0.1.1-rc.2.winexe.12')
    expect(packagedWebExeVersion('0.1.1-rc.2', '0')).toBe('0.1.1-rc.2.winexe.0')
  })

  it('rejects an empty base or a non-integer iteration', () => {
    expect(() => packagedWebExeVersion('')).toThrow(/base is empty/)
    expect(() => packagedWebExeVersion('0.1.1-rc.2', '12a')).toThrow(/decimal integer/)
  })
})

describe('resolvePackagedWebExeVersion', () => {
  it('prefers --product-version over environment stamps', () => {
    expect(resolvePackagedWebExeVersion('0.1.1-rc.2', {
      DSH_WEB_EXE_VERSION: 'env-full',
      DSH_WEB_EXE_ITERATION: '9',
    }, 'flagged')).toBe('flagged')
  })

  it('uses DSH_WEB_EXE_VERSION then the iteration env', () => {
    expect(resolvePackagedWebExeVersion('0.1.1-rc.2', { DSH_WEB_EXE_VERSION: 'from-env' })).toBe('from-env')
    expect(resolvePackagedWebExeVersion('0.1.1-rc.2', { DSH_WEB_EXE_ITERATION: '7' })).toBe('0.1.1-rc.2.winexe.7')
  })
})
