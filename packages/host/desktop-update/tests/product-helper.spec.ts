import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { digestMismatch, parseSha256Digest } from '../src/digest.ts'
import { applyHelperScript, powershellLiteral } from '../src/helper.ts'
import { isLoopbackHostname, isLoopbackRequest, localLanIpv4Addresses } from '../src/loopback.ts'
import { peelExtractRootName } from '../src/controller.ts'
import {
  detectPackagedProduct, isPackagedExtract, readProductVersion, shouldCopyProductEntry,
} from '../src/product.ts'

describe('product detection', () => {
  it('requires a non-empty VERSION beside the launcher', () => {
    const productDir = join('app')
    const files = new Map<string, string>([
      [join(productDir, 'VERSION'), '0.1.2-rc.1.winexe.19\n'],
    ])
    expect(detectPackagedProduct(
      join(productDir, 'dsh-web.exe'),
      path => files.has(path),
      path => files.get(path),
    )).toEqual({ productDir, version: '0.1.2-rc.1.winexe.19' })
    expect(detectPackagedProduct(join(productDir, 'dsh-web.exe'), () => false, () => undefined)).toBeUndefined()
    expect(detectPackagedProduct(
      join(productDir, 'dsh-web.exe'),
      path => path.endsWith('VERSION'),
      () => undefined,
    )).toBeUndefined()
    expect(detectPackagedProduct(
      join('snapshot', 'dsh-web.exe'),
      path => path === join(productDir, 'VERSION'),
      path => files.get(path),
      [productDir],
    )).toEqual({ productDir, version: '0.1.2-rc.1.winexe.19' })
    expect(readProductVersion(productDir, () => '  \n')).toBeUndefined()
    expect(readProductVersion(productDir, () => undefined)).toBeUndefined()
  })

  it('never copies .config and requires VERSION plus a launcher in an extract', () => {
    expect(shouldCopyProductEntry('.config')).toBe(false)
    expect(shouldCopyProductEntry('.')).toBe(false)
    expect(shouldCopyProductEntry('..')).toBe(false)
    expect(shouldCopyProductEntry('lib')).toBe(true)
    const root = join('extract')
    const exists = new Set([join(root, 'VERSION'), join(root, 'dsh-web.exe')])
    expect(isPackagedExtract(root, path => exists.has(path))).toBe(true)
    expect(isPackagedExtract(join('other'), () => false)).toBe(false)
    const unix = join('extract-unix')
    const unixExists = new Set([join(unix, 'VERSION'), join(unix, 'dsh-web')])
    expect(isPackagedExtract(unix, path => unixExists.has(path))).toBe(true)
  })
})

describe('peelExtractRootName', () => {
  it('returns the single wrapping directory and ignores already-flat trees', () => {
    expect(peelExtractRootName([{ name: 'dsh-web-win-x64', isDirectory: true }]))
      .toBe('dsh-web-win-x64')
    expect(peelExtractRootName([
      { name: 'dsh-web.exe', isDirectory: false },
      { name: 'VERSION', isDirectory: false },
    ])).toBeUndefined()
    expect(peelExtractRootName([{ name: '.', isDirectory: true }])).toBeUndefined()
  })
})

describe('digest', () => {
  it('parses sha256 digests and rejects a mismatch or missing field', () => {
    const hex = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    expect(parseSha256Digest(`sha256:${hex}`)).toBe(hex)
    expect(parseSha256Digest('sha256:ZZ')).toBeUndefined()
    expect(parseSha256Digest(undefined)).toBeUndefined()
    expect(digestMismatch(hex, `sha256:${hex}`)).toBeUndefined()
    expect(digestMismatch('bb'.repeat(32), `sha256:${hex}`)).toContain('does not match')
    expect(digestMismatch(hex, undefined)).toContain('missing')
  })
})

describe('loopback', () => {
  it('accepts loopback and this machine\'s LAN IPv4s, rejects other hosts', () => {
    expect(isLoopbackHostname('127.0.0.1')).toBe(true)
    expect(isLoopbackHostname('127.1.2.3')).toBe(true)
    expect(isLoopbackHostname('localhost')).toBe(true)
    expect(isLoopbackHostname('[::1]')).toBe(true)
    expect(isLoopbackHostname('::1')).toBe(true)
    expect(isLoopbackHostname('example.test')).toBe(false)
    expect(Array.isArray(localLanIpv4Addresses())).toBe(true)
    expect(localLanIpv4Addresses({
      lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
      eth0: [
        { family: 'IPv6', internal: false, address: 'fe80::1' },
        { family: 'IPv4', internal: false, address: '10.0.0.7' },
      ],
      eth1: [{ family: 'IPv4', internal: false, address: '10.0.0.8' }],
      utun0: undefined,
    })).toEqual(['10.0.0.7', '10.0.0.8'])
    const lan = ['10.0.0.7', '10.0.0.8'] as const
    expect(isLoopbackRequest(new Request('http://127.0.0.1:3080/api/desktop-update/status'), lan)).toBe(true)
    expect(isLoopbackRequest(new Request('http://example.test/api/desktop-update/status'), lan)).toBe(false)
    expect(isLoopbackRequest({ url: 'not a url' } as Request, lan)).toBe(false)
    // The /api HTTP bridge synthesizes http://dsh.internal and copies Host.
    expect(isLoopbackRequest(new Request('http://dsh.internal/api/desktop-update/status', {
      headers: { host: '127.0.0.1' },
    }), lan)).toBe(true)
    expect(isLoopbackRequest(new Request('http://dsh.internal/api/desktop-update/status', {
      headers: { host: 'localhost' },
    }), lan)).toBe(true)
    expect(isLoopbackRequest(new Request('http://dsh.internal/api/desktop-update/status', {
      headers: { host: '[::1]' },
    }), lan)).toBe(true)
    expect(isLoopbackRequest(new Request('http://dsh.internal/api/desktop-update/status', {
      headers: { host: '10.0.0.7' },
    }), lan)).toBe(true)
    expect(isLoopbackRequest(new Request('http://dsh.internal/api/desktop-update/status', {
      headers: { host: '10.0.0.8' },
    }), lan)).toBe(true)
    expect(isLoopbackRequest(new Request('http://dsh.internal/api/desktop-update/status', {
      headers: { host: 'example.test' },
    }), lan)).toBe(false)
    expect(isLoopbackRequest(new Request('http://example.test/api/desktop-update/status', {
      headers: { host: '10.0.0.7' },
    }), lan)).toBe(true)
    expect(isLoopbackRequest(new Request('http://127.0.0.1/api/desktop-update/status', {
      headers: { host: 'example.test' },
    }), lan)).toBe(false)
  })
})

describe('apply helper', () => {
  it('quotes paths and skips .config during robocopy', () => {
    expect(powershellLiteral('C:\\a\\b\'c')).toBe('\'C:\\a\\b\'\'c\'')
    const script = applyHelperScript({
      parentPid: 42,
      extractDir: 'C:\\home\\desktop-update\\extract',
      productDir: 'C:\\app',
      exePath: 'C:\\app\\dsh-web.exe',
    })
    expect(script).toContain('/XD .config')
    expect(script).toContain('Start-Process')
    expect(script).toContain('$parentPid = 42')
    expect(script).toContain('\'C:\\app\\dsh-web.exe\'')
  })
})
