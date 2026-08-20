import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_DESKTOP_LISTEN_HOST,
  DEFAULT_DESKTOP_LISTEN_PORT,
  desktopListenArgs,
  desktopListenPath,
  loadDesktopListen,
  parseDesktopListen,
  saveDesktopListen,
} from '../src/desktop-listen.ts'

const temps: string[] = []

afterEach(() => {
  for (const path of temps.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('parseDesktopListen', () => {
  it('accepts the two bind hosts and a TCP port', () => {
    expect(parseDesktopListen({ host: '127.0.0.1', port: 0 })).toEqual({ host: '127.0.0.1', port: 0 })
    expect(parseDesktopListen({ host: '0.0.0.0', port: 65535 })).toEqual({ host: '0.0.0.0', port: 65535 })
    expect(parseDesktopListen({ host: '10.0.0.1', port: 3080 })).toBeUndefined()
    expect(parseDesktopListen({ host: '127.0.0.1', port: 1.5 })).toBeUndefined()
    expect(parseDesktopListen({ host: '127.0.0.1' })).toBeUndefined()
    expect(parseDesktopListen(null)).toBeUndefined()
  })
})

describe('loadDesktopListen / saveDesktopListen', () => {
  it('returns the default when the file is missing or corrupt', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-listen-'))
    temps.push(home)
    expect(loadDesktopListen(home)).toEqual({
      host: DEFAULT_DESKTOP_LISTEN_HOST,
      port: DEFAULT_DESKTOP_LISTEN_PORT,
    })
    writeFileSync(desktopListenPath(home), '{', 'utf8')
    expect(loadDesktopListen(home).port).toBe(DEFAULT_DESKTOP_LISTEN_PORT)
    writeFileSync(desktopListenPath(home), '{"host":"10.0.0.1","port":9}\n', 'utf8')
    expect(loadDesktopListen(home).host).toBe(DEFAULT_DESKTOP_LISTEN_HOST)
  })

  it('round-trips a valid listen file', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-listen-'))
    temps.push(home)
    saveDesktopListen(home, { host: '0.0.0.0', port: 8080 })
    expect(loadDesktopListen(home)).toEqual({ host: '0.0.0.0', port: 8080 })
    expect(desktopListenArgs({ host: '0.0.0.0', port: 8080 })).toEqual(['--host', '0.0.0.0', '--port', '8080', '--no-open'])
  })
})
