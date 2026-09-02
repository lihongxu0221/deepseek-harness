import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PACKAGED_WEB_HOME_DIR,
  restorePackagedWebHome,
  stashPackagedWebHome,
  withPreservedPackagedWebHome,
} from './preserve-packaged-web-home.ts'

const roots: string[] = []

function fixture(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('withPreservedPackagedWebHome', () => {
  it('uses .config as the packaged home directory name', () => {
    expect(PACKAGED_WEB_HOME_DIR).toBe('.config')
  })

  it('leaves a folder without .config unchanged after action', async () => {
    const directory = fixture('dsh-web-config-missing-')
    writeFileSync(join(directory, 'keep.txt'), 'keep')
    await withPreservedPackagedWebHome(directory, async () => {
      expect(existsSync(join(directory, PACKAGED_WEB_HOME_DIR))).toBe(false)
    })
    expect(existsSync(join(directory, 'keep.txt'))).toBe(true)
    expect(existsSync(join(directory, PACKAGED_WEB_HOME_DIR))).toBe(false)
  })

  it('restores .config after the parent tree is deleted', async () => {
    const directory = fixture('dsh-web-config-restore-')
    const home = join(directory, PACKAGED_WEB_HOME_DIR)
    mkdirSync(join(home, 'sessions'), { recursive: true })
    writeFileSync(join(home, '.credentials.yaml'), 'marker: credentials')
    writeFileSync(join(home, 'sessions', 'one.json'), '{"ok":true}')
    await withPreservedPackagedWebHome(directory, async () => {
      rmSync(directory, { recursive: true, force: true })
    })
    expect(readFileSync(join(home, '.credentials.yaml'), 'utf8')).toBe('marker: credentials')
    expect(readFileSync(join(home, 'sessions', 'one.json'), 'utf8')).toBe('{"ok":true}')
  })

  it('omits node_modules junctions under profiles and keeps profile files', async () => {
    const directory = fixture('dsh-web-config-fallback-')
    const home = join(directory, PACKAGED_WEB_HOME_DIR)
    const packageDir = fixture('dsh-web-config-pkg-')
    writeFileSync(join(packageDir, 'index.js'), 'module.exports = 1\n')
    mkdirSync(join(home, 'profiles', 'web', 'node_modules', '@scope'), { recursive: true })
    mkdirSync(join(home, 'profiles', 'node_modules', '@scope'), { recursive: true })
    mkdirSync(join(home, 'profiles', 'web', '.dsh-module-fallback'), { recursive: true })
    writeFileSync(join(home, 'profiles', 'web', 'package.json'), '{"name":"web"}')
    writeFileSync(join(home, 'profiles', 'web', '.dsh-module-fallback', 'keep.txt'), 'fallback')
    writeFileSync(join(home, '.credentials.yaml'), 'marker: credentials')
    const junction = process.platform === 'win32' ? 'junction' as const : 'dir' as const
    symlinkSync(packageDir, join(home, 'profiles', 'node_modules', '@scope', 'pkg'), junction)
    symlinkSync(packageDir, join(home, 'profiles', 'web', 'node_modules', '@scope', 'pkg'), junction)
    await withPreservedPackagedWebHome(directory, async () => {
      rmSync(directory, { recursive: true, force: true })
    })
    expect(readFileSync(join(home, '.credentials.yaml'), 'utf8')).toBe('marker: credentials')
    expect(readFileSync(join(home, 'profiles', 'web', 'package.json'), 'utf8')).toBe('{"name":"web"}')
    expect(existsSync(join(home, 'profiles', 'node_modules'))).toBe(false)
    expect(existsSync(join(home, 'profiles', 'web', 'node_modules'))).toBe(false)
    expect(existsSync(join(home, 'profiles', 'web', '.dsh-module-fallback'))).toBe(false)
  })

  it('restores .config when action throws', async () => {
    const directory = fixture('dsh-web-config-throw-')
    const home = join(directory, PACKAGED_WEB_HOME_DIR)
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, 'settings.yaml'), 'provider: kept')
    await expect(withPreservedPackagedWebHome(directory, async () => {
      rmSync(directory, { recursive: true, force: true })
      throw new Error('deploy failed')
    })).rejects.toThrow('deploy failed')
    expect(readFileSync(join(home, 'settings.yaml'), 'utf8')).toBe('provider: kept')
  })

  it('replaces a newly created .config with the stashed one', async () => {
    const directory = fixture('dsh-web-config-replace-')
    const home = join(directory, PACKAGED_WEB_HOME_DIR)
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, 'settings.yaml'), 'provider: original')
    await withPreservedPackagedWebHome(directory, async () => {
      rmSync(directory, { recursive: true, force: true })
      mkdirSync(home, { recursive: true })
      writeFileSync(join(home, 'settings.yaml'), 'provider: staged')
    })
    expect(readFileSync(join(home, 'settings.yaml'), 'utf8')).toBe('provider: original')
  })

  it('does not create a stash when .config is absent', async () => {
    const directory = fixture('dsh-web-config-nostash-')
    await expect(stashPackagedWebHome(directory)).resolves.toBeUndefined()
    await expect(restorePackagedWebHome(directory, undefined)).resolves.toBeUndefined()
  })

  it('keeps both rebuild deletions on this helper', () => {
    const source = readFileSync(new URL('./build-web-exe.ts', import.meta.url), 'utf8')
    expect(source).toContain("import { withPreservedPackagedWebHome } from './preserve-packaged-web-home.ts'")
    expect(source).toContain('withPreservedPackagedWebHome(this.staging, deploy)')
    expect(source).toContain('withPreservedPackagedWebHome(product, async () => {')
    expect(source).toContain("import { setWindowsPeSubsystem } from './windows-pe-subsystem.ts'")
    expect(source).toContain("setWindowsPeSubsystem(launcher, 'gui')")
  })
})
