import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  extraPackagedArgv,
  PACKAGED_WEB_ENTRY_REL,
  resolvePackagedScriptArg,
  resolvePackagedWebEntry,
} from '../src/packaged-web-entry.ts'

describe('resolvePackagedWebEntry', () => {
  it('resolves lib/packaged-web-bin.js beside the launcher and refuses a missing file', () => {
    const execPath = join('D:\\dist', 'dsh-web.exe')
    const expected = join('D:\\dist', PACKAGED_WEB_ENTRY_REL)
    expect(resolvePackagedWebEntry(execPath, path => path === expected)).toBe(expected)
    expect(() => resolvePackagedWebEntry(execPath, () => false)).toThrow(/Keep this executable inside the built folder/)
  })

  it('keeps the pkg SEA launcher in CommonJS so the embedder can run it', () => {
    const launcher = readFileSync(fileURLToPath(new URL('../packaged-web-launcher.cjs', import.meta.url)), 'utf8')
    expect(launcher).toMatch(/require\('node:path'\)/)
    expect(launcher).not.toMatch(/^import /m)
    expect(launcher).toContain("join(dirname(process.execPath), 'lib', 'packaged-web-bin.js')")
    expect(launcher).toContain('Keep this executable inside the built folder')
    expect(launcher).toContain('resolvePackagedScriptArg')
    expect(launcher).toContain('.cjs')
  })
})

describe('extraPackagedArgv', () => {
  const launcher = resolve('D:\\dist\\packaged-web-launcher.cjs')
  const entry = resolve('D:\\dist\\lib\\packaged-web-bin.js')
  const worker = resolve('D:\\dist\\node_modules\\@deepseek-ai\\dsh-host-directory-picker-native\\lib\\worker.cjs')

  it('drops the node/SEA launcher slot and keeps a worker script', () => {
    expect(extraPackagedArgv(['D:\\dist\\dsh-web.exe', launcher, worker], launcher)).toEqual([worker])
    expect(extraPackagedArgv(['node', launcher, worker], launcher)).toEqual([worker])
    expect(extraPackagedArgv(['D:\\dist\\dsh-web.exe', entry, worker], entry)).toEqual([worker])
  })

  it('keeps a lone worker argument when the SEA omits the launcher path', () => {
    expect(extraPackagedArgv(['D:\\dist\\dsh-web.exe', worker], launcher)).toEqual([worker])
  })

  it('skips a pkg-duplicated execPath before the worker script', () => {
    expect(extraPackagedArgv(['D:\\dist\\dsh-web.exe', 'D:/dist/dsh-web.exe', worker], launcher)).toEqual([worker])
  })

  it('returns no extras for a double-click argv', () => {
    expect(extraPackagedArgv(['D:\\dist\\dsh-web.exe'], launcher)).toEqual([])
    expect(extraPackagedArgv(['D:\\dist\\dsh-web.exe', launcher], launcher)).toEqual([])
  })
})

describe('resolvePackagedScriptArg', () => {
  const worker = resolve('D:\\dist\\worker.cjs')

  it('resolves an existing script and ignores everything else', () => {
    expect(resolvePackagedScriptArg([worker], path => path === worker)).toBe(worker)
    expect(resolvePackagedScriptArg([worker], () => false)).toBeUndefined()
    expect(resolvePackagedScriptArg(['--port', '8080'], () => true)).toBeUndefined()
    expect(resolvePackagedScriptArg([], () => true)).toBeUndefined()
  })
})
