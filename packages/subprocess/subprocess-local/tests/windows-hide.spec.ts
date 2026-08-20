import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { spawnSubprocess, taskkillProcessTree } from '../src/spawn.ts'

const { spawnCalls, spawnSyncCalls } = vi.hoisted(() => ({
  spawnCalls: [] as Array<{ windowsHide?: boolean }>,
  spawnSyncCalls: [] as Array<{ windowsHide?: boolean }>,
}))

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  const optionsOf = (args: unknown[]): { windowsHide?: boolean } | undefined =>
    args.find((arg): arg is { windowsHide?: boolean } =>
      arg !== null && typeof arg === 'object' && !Array.isArray(arg) && 'windowsHide' in arg)
  return {
    ...actual,
    spawn(...args: Parameters<typeof actual.spawn>) {
      spawnCalls.push({ windowsHide: optionsOf(args)?.windowsHide })
      return actual.spawn(...args)
    },
    spawnSync(...args: Parameters<typeof actual.spawnSync>) {
      spawnSyncCalls.push({ windowsHide: optionsOf(args)?.windowsHide })
      return actual.spawnSync(...args)
    },
  }
})

const spillDir = mkdtempSync(join(tmpdir(), 'dsh-subprocess-hide-'))

afterEach(() => {
  spawnCalls.length = 0
  spawnSyncCalls.length = 0
})

describe('Windows console hide', () => {
  it('passes windowsHide on an ordinary spawn', async () => {
    const running = spawnSubprocess({
      argv: [process.execPath, '-e', ''],
      cwd: process.cwd(),
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 1024 },
        stderr: { maxBytes: 1024 },
      },
      graceMs: 3_000,
    }, { spillDir })
    await running.done
    expect(spawnCalls.length).toBeGreaterThan(0)
    expect(spawnCalls.every(call => call.windowsHide === true)).toBe(true)
  })

  it('passes windowsHide on taskkillProcessTree', () => {
    taskkillProcessTree(2 ** 30)
    expect(spawnSyncCalls).toEqual([{ windowsHide: true }])
  })
})
