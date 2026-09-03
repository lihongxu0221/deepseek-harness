import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DSH_HOME_ENV } from '@deepseek-ai/dsh-home-paths'
import {
  applyPackagedWebHome,
  applyPackagedWebProfile,
  DSH_PROFILE_ENV,
  PACKAGED_WEB_PROFILE,
  packagedWebHomeDir,
} from '../src/packaged-web-home.ts'

describe('applyPackagedWebHome', () => {
  it('points an unset DSH_HOME at <exeDir>/.config and creates it', () => {
    const env: NodeJS.ProcessEnv = {}
    const created: string[] = []
    const execPath = resolve('D:\\dist', 'dsh-web.exe')
    const home = applyPackagedWebHome(execPath, env, (path) => {
      created.push(path)
    })
    expect(home).toBe(resolve(packagedWebHomeDir(execPath)))
    expect(env[DSH_HOME_ENV]).toBe(home)
    expect(created).toEqual([home])
  })

  it('treats a whitespace-only DSH_HOME as unset', () => {
    const env: NodeJS.ProcessEnv = { [DSH_HOME_ENV]: '   ' }
    const execPath = resolve('D:\\dist', 'dsh-web.exe')
    const home = applyPackagedWebHome(execPath, env, () => undefined)
    expect(home).toBe(resolve(packagedWebHomeDir(execPath)))
    expect(env[DSH_HOME_ENV]).toBe(home)
  })

  it('keeps an explicit DSH_HOME and still creates that directory', () => {
    const configured = resolve('E:\\custom-home')
    const env: NodeJS.ProcessEnv = { [DSH_HOME_ENV]: configured }
    const created: string[] = []
    const home = applyPackagedWebHome(resolve('D:\\dist', 'dsh-web.exe'), env, (path) => {
      created.push(path)
    })
    expect(home).toBe(configured)
    expect(env[DSH_HOME_ENV]).toBe(configured)
    expect(created).toEqual([configured])
  })

  it('keeps the packaged desktop entry on this home path', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/packaged-web-bin.ts', import.meta.url)), 'utf8')
    expect(source).toContain('applyPackagedWebHome(process.execPath)')
    expect(source).toContain('applyPackagedWebProfile()')
    expect(source).toContain("loadLayeredEnv('dsh')")
    expect(source).toContain("process.platform === 'win32'")
    expect(source).toContain('runPackagedWebDesktop(defaultPackagedWebDesktopIo())')
  })
})

describe('applyPackagedWebProfile', () => {
  it('records the packaged GUI profile for host plugins that read DSH_PROFILE', () => {
    const env: NodeJS.ProcessEnv = {}
    applyPackagedWebProfile(env)
    expect(env[DSH_PROFILE_ENV]).toBe(PACKAGED_WEB_PROFILE)
  })
})
