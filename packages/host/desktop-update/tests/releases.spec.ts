import { describe, expect, it } from 'vitest'
import {
  isOutdated, parseGitHubReleases, pickNewestZip, versionFromAssetName,
} from '../src/releases.ts'
import type { GitHubRelease } from '../src/types.ts'

const PREFIX = 'dsh-web-win-x64-'

function release(tag: string, names: string[], extra?: Partial<GitHubRelease>): GitHubRelease {
  return {
    tag_name: tag,
    prerelease: true,
    draft: false,
    body: `notes for ${tag}`,
    assets: names.map(name => ({
      name,
      browser_download_url: `https://example.test/${name}`,
      size: 10,
      digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    })),
    ...extra,
  }
}

describe('versionFromAssetName', () => {
  it('reads the stamp between the prefix and .zip', () => {
    expect(versionFromAssetName('dsh-web-win-x64-0.1.2-rc.1.winexe.19.zip', PREFIX))
      .toBe('0.1.2-rc.1.winexe.19')
    expect(versionFromAssetName('dsh-web-win-x64-0.1.2-rc.1.winexe.19.zip', '')).toBeUndefined()
    expect(versionFromAssetName('other-0.1.0.zip', PREFIX)).toBeUndefined()
    expect(versionFromAssetName('dsh-web-win-x64-0.1.0.tar.gz', PREFIX)).toBeUndefined()
    expect(versionFromAssetName('dsh-web-win-x64-not-a-version.zip', PREFIX)).toBeUndefined()
  })
})

describe('parseGitHubReleases', () => {
  it('accepts a well-formed array and rejects malformed payloads', () => {
    expect(parseGitHubReleases([
      {
        tag_name: 'winexe-1.0.0',
        prerelease: true,
        draft: false,
        body: null,
        assets: [{ name: 'a.zip', browser_download_url: 'https://example.test/a.zip', size: 3 }],
      },
    ])).toEqual([
      {
        tag_name: 'winexe-1.0.0',
        prerelease: true,
        draft: false,
        body: null,
        assets: [{ name: 'a.zip', browser_download_url: 'https://example.test/a.zip', size: 3 }],
      },
    ])
    expect(() => parseGitHubReleases({})).toThrow('not an array')
    expect(() => parseGitHubReleases([null])).toThrow('not an object')
    expect(() => parseGitHubReleases([{}])).toThrow('tag_name')
    expect(() => parseGitHubReleases([{ tag_name: 't' }])).toThrow('assets')
    expect(() => parseGitHubReleases([{ tag_name: 't', assets: [null] }])).toThrow('not an object')
    expect(() => parseGitHubReleases([{ tag_name: 't', assets: [{}] }])).toThrow('name')
    expect(() => parseGitHubReleases([{
      tag_name: 't', assets: [{ name: 'a.zip' }],
    }])).toThrow('browser_download_url')
    expect(parseGitHubReleases([{
      tag_name: 't',
      assets: [{ name: 'a.zip', browser_download_url: 'https://example.test/a.zip', size: 'nope', digest: 'sha256:ab' }],
    }])[0]?.assets[0]).toMatchObject({ size: 0, digest: 'sha256:ab' })
    expect(parseGitHubReleases([{ tag_name: 't', body: 'hi', assets: [] }])[0]?.body).toBe('hi')
  })
})

describe('pickNewestZip', () => {
  it('skips drafts, zipballs, and non-matching names, then picks the highest stamp', () => {
    const newest = pickNewestZip([
      release('winexe-0.1.2-alpha.5.winexe.17', ['dsh-web-win-x64-0.1.2-alpha.5.winexe.17.zip']),
      { ...release('draft', ['dsh-web-win-x64-9.0.0.winexe.1.zip']), draft: true },
      release('source-only', ['source.zip']),
      release('winexe-0.1.2-rc.1.winexe.19', [
        'source.tar.gz',
        'dsh-web-win-x64-0.1.2-rc.1.winexe.19.zip',
      ]),
      release('winexe-0.1.2-rc.1.winexe.18', ['dsh-web-win-x64-0.1.2-rc.1.winexe.18.zip']),
    ], PREFIX)
    expect(newest?.version).toBe('0.1.2-rc.1.winexe.19')
    expect(newest?.assetName).toBe('dsh-web-win-x64-0.1.2-rc.1.winexe.19.zip')
    expect(newest?.notes).toBe('notes for winexe-0.1.2-rc.1.winexe.19')
    expect(pickNewestZip([], PREFIX)).toBeUndefined()
    expect(pickNewestZip([release('x', ['nope.zip'])], PREFIX)).toBeUndefined()
  })
})

describe('isOutdated', () => {
  it('is true only when latest is strictly newer', () => {
    expect(isOutdated('0.1.2-alpha.5.winexe.17', '0.1.2-rc.1.winexe.19')).toBe(true)
    expect(isOutdated('0.1.2-rc.1.winexe.19', '0.1.2-rc.1.winexe.19')).toBe(false)
    expect(isOutdated('0.1.2-rc.1.winexe.19', '0.1.2-rc.1.winexe.18')).toBe(false)
  })
})
