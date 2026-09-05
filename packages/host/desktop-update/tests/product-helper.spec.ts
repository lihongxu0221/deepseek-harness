import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { digestMismatch, parseSha256Digest } from '../src/digest.ts'
import { applyHelperScript, powershellLiteral } from '../src/helper.ts'
import { isLoopbackHostname, isLoopbackRequest } from '../src/loopback.ts'
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
  it('accepts loopback hosts and rejects LAN literals', () => {
    expect(isLoopbackHostname('127.0.0.1')).toBe(true)
    expect(isLoopbackHostname('127.1.2.3')).toBe(true)
    expect(isLoopbackHostname('localhost')).toBe(true)
    expect(isLoopbackHostname('[::1]')).toBe(true)
    expect(isLoopbackHostname('::1')).toBe(true)
    expect(isLoopbackHostname('192.168.1.9')).toBe(false)
    expect(isLoopbackHostname('example.test')).toBe(false)
    expect(isLoopbackRequest(new Request('http://127.0.0.1:3080/api/desktop-update/status'))).toBe(true)
    expect(isLoopbackRequest(new Request('http://192.168.0.2/api/desktop-update/status'))).toBe(false)
    expect(isLoopbackRequest({ url: 'not a url' } as Request)).toBe(false)
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
