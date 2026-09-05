import { describe, expect, it } from 'vitest'
import {
  compareSemver, compareWinexeVersion, parseSemver, parseWinexeVersion,
} from '../src/version.ts'

describe('parseSemver', () => {
  it('parses release, prerelease, and build metadata', () => {
    expect(parseSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] })
    expect(parseSemver('v0.1.2-rc.1')).toEqual({
      major: 0, minor: 1, patch: 2, prerelease: ['rc', '1'],
    })
    expect(parseSemver('1.0.0+build')).toEqual({ major: 1, minor: 0, patch: 0, prerelease: [] })
    expect(parseSemver('')).toBeUndefined()
    expect(parseSemver('1.2')).toBeUndefined()
  })
})

describe('compareSemver', () => {
  it('orders numeric fields, then prerelease identifiers', () => {
    expect(compareSemver('1.0.0', '1.0.1')).toBeLessThan(0)
    expect(compareSemver('1.1.0', '1.0.9')).toBeGreaterThan(0)
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0)
    expect(compareSemver('1.0.0-rc.1', '1.0.0')).toBeLessThan(0)
    expect(compareSemver('1.0.0', '1.0.0-rc.1')).toBeGreaterThan(0)
    expect(compareSemver('1.0.0-alpha.2', '1.0.0-alpha.10')).toBeLessThan(0)
    expect(compareSemver('1.0.0-alpha.10', '1.0.0-alpha.2')).toBeGreaterThan(0)
    expect(compareSemver('1.0.0-alpha', '1.0.0-alpha.1')).toBeLessThan(0)
    expect(compareSemver('1.0.0-alpha.1', '1.0.0-alpha')).toBeGreaterThan(0)
    expect(compareSemver('1.0.0-1', '1.0.0-beta')).toBeLessThan(0)
    expect(compareSemver('1.0.0-beta', '1.0.0-1')).toBeGreaterThan(0)
    expect(compareSemver('1.0.0-rc.1', '1.0.0-rc.1')).toBe(0)
    expect(compareSemver('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0)
    expect(compareSemver('1.0.0-beta', '1.0.0-alpha')).toBeGreaterThan(0)
    expect(compareSemver('not-a-version', '1.0.0')).toBeLessThan(0)
    expect(compareSemver('1.0.0', 'not-a-version')).toBeGreaterThan(0)
    expect(compareSemver('nope', 'nah')).toBe(0)
  })
})

describe('parseWinexeVersion', () => {
  it('strips a winexe- tag prefix and optional iteration', () => {
    expect(parseWinexeVersion('0.1.2-rc.1.winexe.19')).toEqual({
      raw: '0.1.2-rc.1.winexe.19', base: '0.1.2-rc.1', iter: 19,
    })
    expect(parseWinexeVersion('winexe-0.1.2-alpha.5.winexe.17')).toEqual({
      raw: '0.1.2-alpha.5.winexe.17', base: '0.1.2-alpha.5', iter: 17,
    })
    expect(parseWinexeVersion(' 0.1.2-rc.1 ')).toEqual({
      raw: '0.1.2-rc.1', base: '0.1.2-rc.1', iter: 0,
    })
    expect(parseWinexeVersion('')).toBeUndefined()
    expect(parseWinexeVersion('0.1.2.winexe.x')).toBeUndefined()
    expect(parseWinexeVersion('notsemver.winexe.1')).toBeUndefined()
  })
})

describe('compareWinexeVersion', () => {
  it('compares base semver first and iteration only as a tiebreaker', () => {
    expect(compareWinexeVersion('0.1.2-rc.1.winexe.19', '0.1.2-alpha.5.winexe.17'))
      .toBeGreaterThan(0)
    expect(compareWinexeVersion('0.1.2-rc.1.winexe.18', '0.1.2-rc.1.winexe.19'))
      .toBeLessThan(0)
    expect(compareWinexeVersion('0.1.2-rc.1', '0.1.2-rc.1.winexe.19')).toBeLessThan(0)
    expect(compareWinexeVersion('0.1.2-rc.1.winexe.19', '0.1.2-rc.1.winexe.19')).toBe(0)
    expect(compareWinexeVersion('nope', '0.1.0')).toBeLessThan(0)
    expect(compareWinexeVersion('0.1.0', 'nope')).toBeGreaterThan(0)
    expect(compareWinexeVersion('nope', 'nah')).toBe(0)
  })
})
