import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { escapeCmdStartUrl } from '@deepseek-ai/dsh-web-app'
import {
  openDesktopWindow,
  parseLocalWebUrl,
  resolveChromiumAppBrowser,
  type DesktopWindowIo,
  type SpawnedDesktopWindow,
} from '../src/open-desktop-window.ts'

function fakeWindow(): SpawnedDesktopWindow & { exit(code: number | null): void; fail(error: Error): void } {
  const emitter = new EventEmitter()
  return {
    on(event, listener) {
      emitter.on(event, listener)
    },
    exit(code) {
      emitter.emit('exit', code)
    },
    fail(error) {
      emitter.emit('error', error)
    },
  }
}

function io(overrides: Partial<DesktopWindowIo> & Pick<DesktopWindowIo, 'existsSync' | 'spawn'>): DesktopWindowIo {
  return {
    platform: 'win32',
    env: {
      PROGRAMFILES: 'C:\\Program Files',
      'PROGRAMFILES(X86)': 'C:\\Program Files (x86)',
      LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local',
    },
    userDataDir: 'C:\\Users\\tester\\.dsh\\desktop-chromium',
    ...overrides,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('parseLocalWebUrl', () => {
  it('accepts a loopback http URL with a port and rejects everything else', () => {
    expect(parseLocalWebUrl('http://127.0.0.1:3080').href).toBe('http://127.0.0.1:3080/')
    expect(() => parseLocalWebUrl('not a url')).toThrow(/refusing to open/)
    expect(() => parseLocalWebUrl('https://127.0.0.1:3080')).toThrow(/refusing to open/)
    expect(() => parseLocalWebUrl('http://example.com:3080')).toThrow(/refusing to open/)
    expect(() => parseLocalWebUrl('http://127.0.0.1')).toThrow(/refusing to open/)
  })
})

describe('resolveChromiumAppBrowser', () => {
  it('prefers DSH_WEB_BROWSER, then Edge, then Chrome', () => {
    const override = 'D:\\browsers\\chrome.exe'
    const edge = join('C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    const chrome = join('C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe')
    expect(resolveChromiumAppBrowser(io({
      env: { DSH_WEB_BROWSER: override },
      existsSync: path => path === override,
      spawn: () => fakeWindow(),
    }))).toBe(override)
    expect(resolveChromiumAppBrowser(io({
      existsSync: path => path === chrome,
      spawn: () => fakeWindow(),
    }))).toBe(chrome)
    expect(resolveChromiumAppBrowser(io({
      existsSync: path => path === edge || path === chrome,
      spawn: () => fakeWindow(),
    }))).toBe(edge)
    expect(resolveChromiumAppBrowser(io({
      existsSync: () => false,
      spawn: () => fakeWindow(),
    }))).toBeUndefined()
  })
})

describe('openDesktopWindow', () => {
  it('opens a waitable Edge app window on Windows', async () => {
    const edge = join('C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    const child = fakeWindow()
    const spawned: Array<{ command: string; args: readonly string[] }> = []
    const opened = openDesktopWindow('http://127.0.0.1:3080', io({
      existsSync: path => path === edge,
      spawn: (command, args) => {
        spawned.push({ command, args })
        return child
      },
    }))
    expect(opened).toBeDefined()
    expect(spawned).toEqual([{
      command: edge,
      args: [
        '--app=http://127.0.0.1:3080',
        '--user-data-dir=C:\\Users\\tester\\.dsh\\desktop-chromium',
        '--window-size=1400,900',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    }])
    const wait = opened!.wait
    child.exit(0)
    await expect(wait).resolves.toBe(0)
  })

  it('treats a signaled app-window exit as code 0', async () => {
    const edge = join('C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    const child = fakeWindow()
    const opened = openDesktopWindow('http://127.0.0.1:3080', io({
      existsSync: path => path === edge,
      spawn: () => child,
    }))
    const wait = opened!.wait
    child.exit(null)
    await expect(wait).resolves.toBe(0)
  })

  it('rejects when the app-window process fails to spawn', async () => {
    const edge = join('C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    const child = fakeWindow()
    const opened = openDesktopWindow('http://127.0.0.1:3080', io({
      existsSync: path => path === edge,
      spawn: () => child,
    }))
    const wait = opened!.wait
    child.fail(new Error('spawn ENOENT'))
    await expect(wait).rejects.toThrow('spawn ENOENT')
  })

  it('falls back to start.exe semantics when no Chromium browser exists', () => {
    const spawned: Array<{ command: string; args: readonly string[] }> = []
    const opened = openDesktopWindow('http://127.0.0.1:3080', io({
      existsSync: () => false,
      spawn: (command, args) => {
        spawned.push({ command, args })
        return fakeWindow()
      },
    }))
    expect(opened).toBeUndefined()
    expect(spawned).toEqual([{ command: 'cmd.exe', args: ['/c', 'start', '', 'http://127.0.0.1:3080'] }])
  })

  it('caret-escapes cmd metacharacters so a token query is not split', () => {
    const spawned: Array<{ command: string; args: readonly string[] }> = []
    const url = 'http://127.0.0.1:3080/?token=ab&boot=1#settings'
    openDesktopWindow(url, io({
      existsSync: () => false,
      spawn: (command, args) => {
        spawned.push({ command, args })
        return fakeWindow()
      },
    }))
    expect(escapeCmdStartUrl(url)).toBe('http://127.0.0.1:3080/?token=ab^&boot=1#settings')
    expect(spawned).toEqual([{ command: 'cmd.exe', args: ['/c', 'start', '', 'http://127.0.0.1:3080/?token=ab^&boot=1#settings'] }])
  })

  it('uses the OS opener off Windows and does not wait', () => {
    const spawned: Array<{ command: string; args: readonly string[] }> = []
    const mac = openDesktopWindow('http://127.0.0.1:3080', io({
      platform: 'darwin',
      existsSync: () => false,
      spawn: (command, args) => {
        spawned.push({ command, args })
        return fakeWindow()
      },
    }))
    const linux = openDesktopWindow('http://127.0.0.1:3080', io({
      platform: 'linux',
      existsSync: () => false,
      spawn: (command, args) => {
        spawned.push({ command, args })
        return fakeWindow()
      },
    }))
    expect(mac).toBeUndefined()
    expect(linux).toBeUndefined()
    expect(spawned).toEqual([
      { command: 'open', args: ['http://127.0.0.1:3080'] },
      { command: 'xdg-open', args: ['http://127.0.0.1:3080'] },
    ])
  })
})
