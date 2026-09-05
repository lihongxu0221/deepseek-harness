import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { initProfile, PROFILE_TEMPLATES, readProfileManifest } from '../packages/boot/app-boot/src/profile.ts'
import {
  buildFreshProfileManifest,
  loadBuiltinManifest,
  planAllowBuildsAppend,
  planProfileMerge,
  seedBuiltinProfilePlugins,
} from './build-builtin-profile-plugins.ts'

const MANIFEST_PATH = resolve(import.meta.dirname, 'builtin-profile-plugins.json')

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'builtin-plugins-'))
}

/** Fake install that records the profile directory and materializes resolvable plugin markers. */
function fakeInstall(names: readonly string[]): { runs: string[]; install: (dir: string) => Promise<void> } {
  const runs: string[] = []
  return {
    runs,
    install: async (dir) => {
      runs.push(dir)
      for (const name of names) {
        const packageDir = join(dir, 'node_modules', ...name.split('/'))
        mkdirSync(packageDir, { recursive: true })
        writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name }))
      }
    },
  }
}

describe('loadBuiltinManifest', () => {
  it('reads the repository pin list with exact versions', () => {
    const manifest = loadBuiltinManifest(MANIFEST_PATH)
    expect(manifest.profile).toBe('web')
    expect(Object.keys(manifest.plugins)).toContain('dshmarket')
    expect(Object.keys(manifest.plugins)).toContain('dsh-free-search')
    for (const version of Object.values(manifest.plugins)) {
      expect(version).toMatch(/^\d+\.\d+\.\d+/)
    }
  })

  it('rejects range and tag pins', () => {
    const root = tempRoot()
    const path = join(root, 'bad.json')
    writeFileSync(path, JSON.stringify({ profile: 'web', plugins: { x: '^1.0.0' } }))
    expect(() => loadBuiltinManifest(path)).toThrow(/exact semver/)
    writeFileSync(path, JSON.stringify({ profile: 'web', plugins: { x: 'latest' } }))
    expect(() => loadBuiltinManifest(path)).toThrow(/exact semver/)
  })

  it('rejects a non-object or profile-less document', () => {
    const root = tempRoot()
    const path = join(root, 'bad.json')
    writeFileSync(path, '[]')
    expect(() => loadBuiltinManifest(path)).toThrow(/must hold a JSON object/)
    writeFileSync(path, JSON.stringify({ plugins: {} }))
    expect(() => loadBuiltinManifest(path)).toThrow(/"profile"/)
  })
})

describe('buildFreshProfileManifest', () => {
  it('matches what initProfile writes for the shipped web template', () => {
    const template = PROFILE_TEMPLATES.web
    if (template === undefined) throw new Error('the shipped web profile template is missing')
    const root = tempRoot()
    const dir = join(root, 'web')
    initProfile(dir, template.bundles, template.patchReload)
    expect(readProfileManifest('test', dir)).toEqual(buildFreshProfileManifest('web'))
  })
})

describe('planProfileMerge', () => {
  const plugins = { 'pkg-a': '1.0.0', 'pkg-b': '2.0.0' }

  it('plans a fresh profile as template bundles followed by the plugins', () => {
    const plan = planProfileMerge(undefined, ['base', 'web-app'], plugins)
    expect(plan.manifest.dsh?.profile?.bundles).toEqual(['base', 'web-app', 'pkg-a', 'pkg-b'])
    expect(plan.manifest.dependencies).toEqual(plugins)
    expect(plan.addedBundles).toEqual(['pkg-a', 'pkg-b'])
    expect(plan.conflicts).toEqual({})
  })

  it('preserves user bundle order and foreign fields, appending only the missing', () => {
    const existing = {
      name: 'dsh-profile-web',
      custom: 7,
      dependencies: { kept: '0.1.0' },
      dsh: { profile: { bundles: ['web-app', 'base'] } },
    }
    const plan = planProfileMerge(existing, ['base', 'web-app'], plugins)
    expect(plan.manifest.dsh?.profile?.bundles).toEqual(['web-app', 'base', 'pkg-a', 'pkg-b'])
    expect(plan.manifest.dependencies).toEqual({ kept: '0.1.0', ...plugins })
    expect((plan.manifest as Record<string, unknown>).custom).toBe(7)
    expect(plan.addedBundles).toEqual(['pkg-a', 'pkg-b'])
  })

  it('keeps a conflicting dependency user-owned unless refresh opts in', () => {
    const existing = { dependencies: { 'pkg-a': '0.9.0' }, dsh: { profile: { bundles: ['pkg-a'] } } }
    const kept = planProfileMerge(existing, [], plugins)
    expect(kept.manifest.dependencies).toEqual({ 'pkg-a': '0.9.0', 'pkg-b': '2.0.0' })
    expect(kept.conflicts).toEqual({ 'pkg-a': '0.9.0' })
    expect(kept.addedDependencies).toEqual(['pkg-b'])
    const refreshed = planProfileMerge(existing, [], plugins, { refresh: true })
    expect(refreshed.manifest.dependencies).toEqual({ 'pkg-a': '1.0.0', 'pkg-b': '2.0.0' })
    expect(refreshed.refreshedDependencies).toEqual(['pkg-a'])
    expect(refreshed.conflicts).toEqual({})
  })

  it('returns the input reference untouched when everything already matches', () => {
    const first = planProfileMerge(undefined, ['base'], plugins).manifest
    const second = planProfileMerge(first, ['base'], plugins)
    expect(second.manifest).toBe(first)
    expect(second.addedBundles).toEqual([])
    expect(second.addedDependencies).toEqual([])
  })
})

describe('seedBuiltinProfilePlugins', () => {
  const builtin = loadBuiltinManifest(MANIFEST_PATH)
  const pluginNames = Object.keys(builtin.plugins)

  function profileDirOf(product: string): string {
    return join(product, '.config', 'profiles', builtin.profile)
  }

  it('seeds a fresh product directory end to end', async () => {
    const product = join(tempRoot(), 'product')
    const fake = fakeInstall(pluginNames)
    const logs: string[] = []
    const result = await seedBuiltinProfilePlugins(product, { runInstall: fake.install, log: line => logs.push(line) })

    expect(result.changed).toBe(true)
    expect(result.ranInstall).toBe(true)
    expect(result.upToDate).toBe(false)
    const profileDir = profileDirOf(product)
    expect(existsSync(join(profileDir, 'package.json'))).toBe(true)
    expect(existsSync(join(profileDir, 'cordis.patch.yml'))).toBe(true)
    expect(existsSync(join(profileDir, 'pnpm-workspace.yaml'))).toBe(true)
    expect(readFileSync(join(profileDir, 'pnpm-workspace.yaml'), 'utf8')).toContain('allowBuilds:')
    expect(readFileSync(join(profileDir, '.npmrc'), 'utf8')).toContain('virtual-store-dir=node_modules/.pnpm')
    const manifest = readProfileManifest('test', profileDir)
    expect(manifest.name).toBe('dsh-profile-web')
    expect((manifest as { private?: boolean }).private).toBe(true)
    expect(manifest.dsh?.profile?.bundles).toEqual([...(PROFILE_TEMPLATES.web?.bundles ?? []), ...pluginNames])
    expect(manifest.dependencies).toMatchObject(builtin.plugins)
    expect(fake.runs).toEqual([profileDir])
    expect(logs.join('\n')).toContain('initializing profile directory')
  })

  it('is a no-op on an already seeded profile', async () => {
    const product = join(tempRoot(), 'product')
    const fake = fakeInstall(pluginNames)
    await seedBuiltinProfilePlugins(product, { manifestPath: MANIFEST_PATH, runInstall: fake.install, log: () => {} })
    const result = await seedBuiltinProfilePlugins(product, { manifestPath: MANIFEST_PATH, runInstall: fake.install, log: () => {} })
    expect(result.upToDate).toBe(true)
    expect(fake.runs.length).toBe(1)
  })

  it('reruns install when allowBuilds gains a new key', async () => {
    const product = join(tempRoot(), 'product')
    const first = join(tempRoot(), 'first.json')
    const second = join(tempRoot(), 'second.json')
    writeFileSync(first, JSON.stringify({ profile: 'web', plugins: { 'pkg-a': '1.0.0' }, allowBuilds: { ssh2: true } }))
    writeFileSync(second, JSON.stringify({ profile: 'web', plugins: { 'pkg-a': '1.0.0' }, allowBuilds: { ssh2: true, sharp: true } }))
    const fake = fakeInstall(['pkg-a'])
    await seedBuiltinProfilePlugins(product, { manifestPath: first, runInstall: fake.install, log: () => {} })
    const result = await seedBuiltinProfilePlugins(product, { manifestPath: second, runInstall: fake.install, log: () => {} })
    expect(result.upToDate).toBe(false)
    expect(result.ranInstall).toBe(true)
    expect(fake.runs.length).toBe(2)
    expect(readFileSync(join(profileDirOf(product), 'pnpm-workspace.yaml'), 'utf8')).toContain('sharp: true')
  })

  it('reinstalls without manifest churn when a plugin stopped resolving', async () => {
    const product = join(tempRoot(), 'product')
    const fake = fakeInstall(pluginNames)
    await seedBuiltinProfilePlugins(product, { manifestPath: MANIFEST_PATH, runInstall: fake.install, log: () => {} })
    rmSync(join(profileDirOf(product), 'node_modules', ...pluginNames[0]!.split('/')), { recursive: true, force: true })
    const result = await seedBuiltinProfilePlugins(product, { manifestPath: MANIFEST_PATH, runInstall: fake.install, log: () => {} })
    expect(result.changed).toBe(false)
    expect(result.ranInstall).toBe(true)
    expect(result.upToDate).toBe(false)
    expect(fake.runs.length).toBe(2)
  })

  it('keeps user-pinned specs until refresh opts in', async () => {
    const product = join(tempRoot(), 'product')
    const fake = fakeInstall(pluginNames)
    await seedBuiltinProfilePlugins(product, { manifestPath: MANIFEST_PATH, runInstall: fake.install, log: () => {} })
    const profileDir = profileDirOf(product)
    const manifestPath = join(profileDir, 'package.json')

    // Hand-edit one dependency to a foreign spec while keeping it resolvable.
    const raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as { dependencies: Record<string, string> }
    const marketName = 'dshmarket'
    raw.dependencies[marketName] = '0.0.1'
    writeFileSync(manifestPath, JSON.stringify(raw))

    const kept = await seedBuiltinProfilePlugins(product, { manifestPath: MANIFEST_PATH, runInstall: fake.install, log: () => {} })
    expect(kept.upToDate).toBe(true)
    expect(kept.conflicts).toEqual({ [marketName]: '0.0.1' })
    const readDeps = (): Record<string, string> =>
      (JSON.parse(readFileSync(manifestPath, 'utf8')) as { dependencies: Record<string, string> }).dependencies
    expect(readDeps()[marketName]).toBe('0.0.1')

    const refreshed = await seedBuiltinProfilePlugins(product, { refresh: true, runInstall: fake.install, log: () => {} })
    expect(refreshed.refreshedDependencies).toEqual([marketName])
    expect(refreshed.ranInstall).toBe(true)
    expect(readDeps()[marketName]).toBe(builtin.plugins[marketName])
  })

  it('writes nothing under dry-run', async () => {
    const product = join(tempRoot(), 'product')
    let installs = 0
    const result = await seedBuiltinProfilePlugins(product, {
      manifestPath: MANIFEST_PATH,
      dryRun: true,
      runInstall: async () => {
        installs += 1
      },
      log: () => {},
    })
    expect(result.changed).toBe(true)
    expect(result.ranInstall).toBe(false)
    expect(installs).toBe(0)
    expect(existsSync(join(product, '.config'))).toBe(false)
  })
})

describe('planAllowBuildsAppend', () => {
  const allow = { 'node-pty': true, ssh2: true }

  it('appends a commented allowlist to a template file', () => {
    const merged = planAllowBuildsAppend('# hoisted linker\npackages:\n  - .\n', allow)
    expect(merged).toContain('\nallowBuilds:\n  node-pty: true\n  ssh2: true\n')
    expect(merged).toMatch(/^# hoisted linker/)
  })

  it('is idempotent and appends only missing keys', () => {
    const first = planAllowBuildsAppend('', allow)
    expect(first).not.toBeNull()
    expect(planAllowBuildsAppend(first!, allow)).toBeNull()
    const owner = planAllowBuildsAppend('allowBuilds:\n  esbuild: false\n', allow)
    expect(owner).toContain('esbuild: false')
    expect(owner).toContain('node-pty: true')
    expect(owner).toContain('ssh2: true')
    expect(planAllowBuildsAppend('', {})).toBeNull()
    const placeholder = planAllowBuildsAppend('allowBuilds:\n  sharp: set this to true or false\n', { sharp: true })
    expect(placeholder).toContain('  sharp: true\n')
    expect(placeholder).not.toContain('set this to true or false')
  })
})
