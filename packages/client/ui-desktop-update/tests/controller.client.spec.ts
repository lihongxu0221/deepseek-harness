import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopUpdateClient } from '../src/client/controller.ts'
import type { DesktopUpdateStatus } from '../src/types.ts'

afterEach(() => {
  vi.useRealTimers()
})

function json(status: DesktopUpdateStatus, http = 200): Response {
  return new Response(JSON.stringify(status), { status: http })
}

describe('DesktopUpdateClient', () => {
  it('loads status, checks, downloads with polling, and applies', async () => {
    const calls: string[] = []
    let progressMode: DesktopUpdateStatus['mode'] = 'downloading'
    const request: typeof fetch = async (input) => {
      const url = String(input)
      calls.push(url)
      if (url.endsWith('/status')) return json({ mode: 'idle', outdated: true, current: '1', latest: '2' })
      if (url.endsWith('/check')) return json({ mode: 'idle', outdated: true, current: '1', latest: '2' })
      if (url.endsWith('/download')) return json({ mode: 'downloading', outdated: true, progress: { received: 1, total: 2 } })
      if (url.endsWith('/progress')) return json({ mode: progressMode, outdated: true })
      if (url.endsWith('/apply')) return json({ mode: 'applying', outdated: true })
      return new Response('', { status: 404 })
    }
    const client = new DesktopUpdateClient(request)
    expect((await client.refresh()).mode).toBe('idle')
    expect(client.store.getSnapshot().loaded).toBe(true)
    expect((await client.check()).outdated).toBe(true)
    vi.useFakeTimers()
    expect((await client.download()).mode).toBe('downloading')
    progressMode = 'ready'
    await vi.advanceTimersByTimeAsync(500)
    expect(client.store.getSnapshot().status.mode).toBe('ready')
    expect((await client.apply()).mode).toBe('applying')
    client.dispose()
    expect(calls.some(url => url.endsWith('/progress'))).toBe(true)
  })

  it('treats a dropped apply Fetch as applying and records other failures', async () => {
    const client = new DesktopUpdateClient(async (input) => {
      if (String(input).endsWith('/apply')) throw new Error('network')
      return json({ mode: 'ready', outdated: true })
    })
    await client.refresh()
    expect((await client.apply()).mode).toBe('applying')
    const failing = new DesktopUpdateClient(async () => {
      throw new Error('boom')
    })
    await expect(failing.refresh()).rejects.toThrow('boom')
    expect(failing.store.getSnapshot().status.mode).toBe('error')
    failing.dispose()
    await expect(failing.refresh()).rejects.toThrow('boom')
  })

  it('does not poll when download is not in flight and ignores updates after dispose', async () => {
    const client = new DesktopUpdateClient(async () => json({ mode: 'idle', outdated: false }))
    expect((await client.download()).mode).toBe('idle')
    const fresh = new DesktopUpdateClient(async () => json({ mode: 'idle', outdated: false }))
    fresh.dispose()
    expect((await fresh.refresh()).mode).toBe('idle')
    expect(fresh.store.getSnapshot().loaded).toBe(false)
  })

  it('keeps polling while progress stays downloading', async () => {
    let progressCalls = 0
    const client = new DesktopUpdateClient(async (input) => {
      if (String(input).endsWith('/download')) {
        return json({ mode: 'downloading', outdated: true, progress: { received: 1, total: 2 } })
      }
      if (String(input).endsWith('/progress')) {
        progressCalls += 1
        return json({ mode: 'downloading', outdated: true, progress: { received: progressCalls, total: 4 } })
      }
      return json({ mode: 'idle', outdated: false })
    })
    vi.useFakeTimers()
    await client.download()
    await vi.advanceTimersByTimeAsync(500)
    expect(progressCalls).toBe(1)
    client.dispose()
  })

  it('stops polling on progress errors and non-Error failures', async () => {
    let progressCalls = 0
    const client = new DesktopUpdateClient(async (input) => {
      const url = String(input)
      if (url.endsWith('/download')) {
        return json({ mode: 'downloading', outdated: true, progress: { received: 0, total: 1 } })
      }
      if (url.endsWith('/progress')) {
        progressCalls += 1
        throw 'nope'
      }
      return json({ mode: 'idle', outdated: false })
    })
    vi.useFakeTimers()
    await client.download()
    await vi.advanceTimersByTimeAsync(500)
    expect(progressCalls).toBe(1)
    client.dispose()
    const other = new DesktopUpdateClient(async () => { throw 'string-fail' })
    await expect(other.refresh()).rejects.toBe('string-fail')
    expect(other.store.getSnapshot().status.error).toBe('string-fail')
  })
})
